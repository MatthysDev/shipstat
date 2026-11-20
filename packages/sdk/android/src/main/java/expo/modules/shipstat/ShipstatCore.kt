package expo.modules.shipstat

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

internal data class ShipstatConfig(
  val endpoint: String,
  val headers: Map<String, String>,
  val flushAt: Int,
  val flushIntervalMs: Long,
  val maxQueueSize: Int,
  val debug: Boolean,
  val compress: Boolean,
)

/**
 * All state is touched only on [executor]. Public entry points enqueue and return.
 * The app uses [get]; tests open their own core with separate preferences and database names.
 */
internal class ShipstatCore internal constructor(
  private val appContext: Context,
  prefsName: String = "dev.shipstat",
  dbName: String = "shipstat_events.db",
) {
  companion object {
    const val SDK_VERSION = "0.1.0"
    /** JobScheduler ids are shared by the whole app: this one spells "SHIP". */
    const val UPLOAD_JOB_ID = 0x53484950

    @Volatile private var instance: ShipstatCore? = null
    fun get(context: Context): ShipstatCore =
      instance ?: synchronized(this) { instance ?: ShipstatCore(context.applicationContext).also { instance = it } }
  }

  private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "shipstat").apply { priority = Thread.MIN_PRIORITY; isDaemon = true }
  }
  private val network = Executors.newSingleThreadExecutor { r -> Thread(r, "shipstat-net").apply { isDaemon = true } }
  private val prefs = appContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
  private val store by lazy { EventStore(appContext, dbName) }
  private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  private var config: ShipstatConfig? = null
  private var autoContext = JSONObject()
  private var context = JSONObject()
  private var anonId = ""
  private var userId: String? = null
  private var enabled = true
  private var pending = 0
  private var inFlight = false
  private var failures = 0
  private var nextAttemptAt = 0L
  /** One-shot: armed only while events wait, so an idle app never wakes up for Shipstat. */
  private var timer: ScheduledFuture<*>? = null
  /** Whether the endpoint reads gzip bodies, learned from its answers during this session. */
  private enum class GzipSupport { UNTESTED, ACCEPTED, REFUSED }
  private var gzipSupport = GzipSupport.UNTESTED
  /** True while the plain-JSON resend that follows a refused gzip batch is in flight. */
  private var probingPlain = false
  private val flushWaiters = ArrayList<() -> Unit>()
  /**
   * Events serialized but not yet on disk. Drained on the next executor turn, so a burst of
   * track() calls becomes one SQLite transaction instead of one per event.
   */
  private val writeBuffer = ArrayList<String>()

  init {
    autoContext = baseContext(appContext)
    run { loadState() }
  }

  /** Every task goes through here: an exception is logged, never thrown at the app. */
  private fun run(block: () -> Unit) = executor.execute {
    try {
      block()
    } catch (e: Exception) {
      Log.w("shipstat", "internal error: ${e.message}")
    }
  }

  // Public API (any thread)

  /** `extra` holds the context keys only JavaScript knows (sdk_version, ota). */
  fun configure(cfg: ShipstatConfig, enabledDefault: Boolean, extra: Map<String, String>) = run {
    config = cfg
    saveConfig(cfg)
    extra.forEach { (k, v) -> autoContext.put(k, v) }
    if (!prefs.contains("enabled") && !enabledDefault) {
      // Disabled from the start: drop what was tracked before init.
      enabled = false
      store.clear()
    }
    pending = store.count()
    cancelTimer()
    log("init, $pending waiting event(s)")
    flushIfNeeded()
    armTimer()
  }

  fun track(name: String, propsJson: String?, tsMs: Double) = run {
    if (!enabled) return@run
    try {
      val ctx = JSONObject(context.toString())
      autoContext.keys().forEach { k -> ctx.put(k, autoContext.get(k)) }
      val event = JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("name", name)
        .put("ts", iso.format(Date(tsMs.toLong())))
        .put("anon_id", anonId)
        .put("user_id", userId ?: JSONObject.NULL)
        .put("props", if (propsJson.isNullOrEmpty()) JSONObject() else JSONObject(propsJson))
        .put("context", ctx)
      writeBuffer.add(event.toString())
      if (writeBuffer.size == 1) run { drainWrites() }
    } catch (e: Exception) {
      log("dropped event $name: ${e.message}")
    }
  }

  fun setContext(values: Map<String, Any?>) = run {
    values.forEach { (k, v) -> primitive(v)?.let { context.put(k, it) } }
    prefs.edit().putString("context", context.toString()).apply()
  }

  fun unsetContext(keys: List<String>) = run {
    keys.forEach { context.remove(it) }
    prefs.edit().putString("context", context.toString()).apply()
  }

  fun identify(id: String?) = run {
    userId = id
    prefs.edit().putString("userId", id).apply()
  }

  /** Opt-out also deletes what is waiting, so nothing tracked before is sent afterwards. */
  fun setEnabled(value: Boolean) = run {
    enabled = value
    prefs.edit().putBoolean("enabled", value).apply()
    if (!value) {
      writeBuffer.clear()
      store.clear()
      pending = 0
      cancelTimer()
      scheduler()?.cancel(UPLOAD_JOB_ID)
    }
  }

  fun reset() = run {
    anonId = UUID.randomUUID().toString()
    context = JSONObject()
    userId = null
    prefs.edit().putString("anonId", anonId).remove("userId").putString("context", "{}").apply()
  }

  fun anonymousId(): String = executor.submit<String> { anonId }.get()

  /** Events on the device that have not been sent yet. */
  fun waitingCount(): Int = executor.submit<Int> { pending + writeBuffer.size }.get()

  /**
   * The app went to the background: try to send now, and in case that fails or Android stops
   * the process first, leave a job that sends once a network is up.
   */
  fun onBackground(done: (() -> Unit)? = null) = run {
    scheduleUpload()
    flush(force = false) {
      if (pending + writeBuffer.size == 0) scheduler()?.cancel(UPLOAD_JOB_ID)
      done?.invoke()
    }
  }

  /** Back in the foreground: the in-app timer sends again, the job is not needed. */
  fun onForeground() = run { scheduler()?.cancel(UPLOAD_JOB_ID) }

  /**
   * Run by [ShipstatUploadJob], possibly in a process Android started without the app's
   * JavaScript: sends with the config saved by the last init. `done(true)` asks for a retry.
   */
  fun uploadInBackground(done: (Boolean) -> Unit) = run {
    if (config == null) {
      config = savedConfig()
      pending = store.count()
    }
    flush(force = true) { done(enabled && config != null && pending + writeBuffer.size > 0) }
  }

  fun flush(force: Boolean = true, done: (() -> Unit)? = null) = executor.execute {
    done?.let { flushWaiters.add(it) }
    if (force) nextAttemptAt = 0L
    try {
      flushIfNeeded(any = true)
    } catch (e: Exception) {
      inFlight = false
      finishWaiters()
      Log.w("shipstat", "flush failed: ${e.message}")
    }
  }

  // Internals (executor only)

  private fun scheduler(): JobScheduler? =
    appContext.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler

  /**
   * One job at most (scheduling again replaces it). Android runs it once a network is up,
   * together with other apps' work, so it costs no extra wake-up.
   */
  private fun scheduleUpload() {
    val cfg = config ?: return
    if (!enabled || pending + writeBuffer.size == 0) return
    val job = JobInfo.Builder(UPLOAD_JOB_ID, ComponentName(appContext, ShipstatUploadJob::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setMinimumLatency(cfg.flushIntervalMs)
      .setBackoffCriteria(cfg.flushIntervalMs.coerceAtLeast(10_000L), JobInfo.BACKOFF_POLICY_EXPONENTIAL)
      .build()
    try {
      scheduler()?.schedule(job)
    } catch (e: Exception) {
      // Missing service declaration or too many jobs: the next launch sends instead.
      log("could not schedule the background upload: ${e.message}")
    }
  }

  /** The job may run in a fresh process: it needs the endpoint and headers from the last init. */
  private fun saveConfig(cfg: ShipstatConfig) {
    val json = JSONObject()
      .put("endpoint", cfg.endpoint)
      .put("headers", JSONObject(cfg.headers))
      .put("flushAt", cfg.flushAt)
      .put("flushIntervalMs", cfg.flushIntervalMs)
      .put("maxQueueSize", cfg.maxQueueSize)
      .put("debug", cfg.debug)
      .put("compress", cfg.compress)
      .toString()
    if (prefs.getString("config", null) != json) prefs.edit().putString("config", json).apply()
  }

  private fun savedConfig(): ShipstatConfig? = try {
    prefs.getString("config", null)?.let { raw ->
      val o = JSONObject(raw)
      val h = o.getJSONObject("headers")
      ShipstatConfig(
        endpoint = o.getString("endpoint"),
        headers = h.keys().asSequence().associateWith { h.getString(it) },
        flushAt = o.getInt("flushAt"),
        flushIntervalMs = o.getLong("flushIntervalMs"),
        maxQueueSize = o.getInt("maxQueueSize"),
        debug = o.getBoolean("debug"),
        compress = o.getBoolean("compress"),
      )
    }
  } catch (_: Exception) {
    null
  }

  private fun loadState() {
    anonId = prefs.getString("anonId", null) ?: UUID.randomUUID().toString().also {
      prefs.edit().putString("anonId", it).apply()
    }
    userId = prefs.getString("userId", null)
    if (prefs.contains("enabled")) enabled = prefs.getBoolean("enabled", true)
    context = try { JSONObject(prefs.getString("context", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
  }

  /**
   * Wakes up once, [afterMs] from now (default: the flush interval), if events are waiting.
   * Runs on [executor] like everything else.
   */
  private fun armTimer(afterMs: Long? = null) {
    val cfg = config ?: return
    if (!enabled || (pending <= 0 && writeBuffer.isEmpty())) return
    if (afterMs == null && timer != null) return
    cancelTimer()
    timer = executor.schedule({
      timer = null
      try {
        flushIfNeeded(any = true)
        armTimer()
      } catch (e: Exception) {
        Log.w("shipstat", "flush failed: ${e.message}")
      }
    }, afterMs ?: cfg.flushIntervalMs, TimeUnit.MILLISECONDS)
  }

  private fun cancelTimer() {
    timer?.cancel(false)
    timer = null
  }

  private fun finishWaiters() {
    val w = ArrayList(flushWaiters)
    flushWaiters.clear()
    w.forEach { it() }
  }

  /** Writes buffered events in one transaction. `thenFlush` is false when called by a flush. */
  private fun drainWrites(thenFlush: Boolean = true) {
    if (writeBuffer.isEmpty()) return
    val batch = ArrayList(writeBuffer)
    writeBuffer.clear()
    store.insert(batch)
    pending += batch.size
    // Trim in chunks: once over the cap by 10 % (min 100), drop the oldest back to the cap.
    val maxSize = config?.maxQueueSize ?: 10_000
    if (pending > maxSize + max(100, maxSize / 10)) {
      store.trimTo(maxSize)
      pending = store.count()
    }
    if (thenFlush) {
      if (pending >= (config?.flushAt ?: 50)) flushIfNeeded()
      armTimer()
    }
  }

  private fun flushIfNeeded(any: Boolean = false) {
    drainWrites(thenFlush = false)
    val cfg = config
    if (cfg == null || !enabled) { finishWaiters(); return }
    if (inFlight) return
    if (pending <= 0 || (!any && pending < cfg.flushAt) || System.currentTimeMillis() < nextAttemptAt) {
      finishWaiters(); return
    }
    val rows = store.peek(max(cfg.flushAt, 1) * 2)
    if (rows.isEmpty()) { pending = 0; finishWaiters(); return }
    val lastSeq = rows.last().first
    val body = StringBuilder()
      .append("{\"schema\":1,\"sent_at\":\"").append(iso.format(Date())).append("\",\"events\":[")
      .append(rows.joinToString(",") { it.second })
      .append("]}")
      .toString()
    val gzipped = cfg.compress && gzipSupport != GzipSupport.REFUSED
    inFlight = true
    network.execute {
      var status = 0
      var retryAfter: Double? = null
      var error: String? = null
      try {
        val conn = URL(cfg.endpoint).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        cfg.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        val bytes = body.toByteArray(Charsets.UTF_8)
        if (gzipped) {
          conn.setRequestProperty("Content-Encoding", "gzip")
          conn.outputStream.use { out -> GZIPOutputStream(out).use { it.write(bytes) } }
        } else {
          conn.outputStream.use { it.write(bytes) }
        }
        status = conn.responseCode
        retryAfter = conn.getHeaderField("Retry-After")?.toDoubleOrNull()
        (if (status >= 400) conn.errorStream else conn.inputStream)?.close()
        conn.disconnect()
      } catch (e: Exception) {
        error = e.message ?: e.javaClass.simpleName
      }
      executor.execute {
        try {
          onResponse(rows.size, lastSeq, status, retryAfter, error, gzipped)
        } catch (e: Exception) {
          inFlight = false
          finishWaiters()
          Log.w("shipstat", "send bookkeeping failed: ${e.message}")
        }
      }
    }
  }

  private fun onResponse(count: Int, lastSeq: Long, status: Int, retryAfter: Double?, error: String?, gzipped: Boolean) {
    inFlight = false
    val cfg = config
    if (probingPlain && !gzipped && error == null && status > 0) {
      // Plain JSON failed too: gzip was not the problem, keep compressing.
      probingPlain = false
      if (status !in 200..299) gzipSupport = GzipSupport.ACCEPTED
    }
    if (error == null && status in 200..299) {
      if (gzipped) gzipSupport = GzipSupport.ACCEPTED
      store.deleteUpTo(lastSeq)
      pending = store.count()
      failures = 0
      log("sent $count event(s)")
      if (pending > 0) { flushIfNeeded(any = true); return }
      cancelTimer()
    } else if (error == null && gzipped && gzipSupport == GzipSupport.UNTESTED && mayRejectGzip(status)) {
      // Some endpoints cannot read gzip bodies: resend this batch as plain JSON right away,
      // once per session.
      gzipSupport = GzipSupport.REFUSED
      probingPlain = true
      log("endpoint refused a gzipped batch (HTTP $status), sending plain JSON from now on")
      flushIfNeeded(any = true)
      return
    } else if (error == null && status in 400..499 && status != 408 && status != 429) {
      store.deleteUpTo(lastSeq)
      pending = store.count()
      log("dropped $count event(s): HTTP $status")
    } else {
      failures += 1
      var delay = min(300.0, 2.0.pow(failures))
      if (retryAfter != null) delay = min(300.0, max(delay, retryAfter))
      // Never retry sooner than the flush interval: an offline phone stays asleep.
      if (cfg != null) delay = max(delay, cfg.flushIntervalMs / 1000.0)
      nextAttemptAt = System.currentTimeMillis() + (delay * 1000).toLong()
      armTimer((delay * 1000).toLong())
      log("send failed (${error ?: "HTTP $status"}), retry in ${delay.toInt()}s")
    }
    finishWaiters()
  }


  /** An HTTP error that may mean "cannot read gzip" rather than "bad events" or "server down". */
  private fun mayRejectGzip(status: Int) = status >= 400 && status !in listOf(401, 403, 408, 429, 502, 503, 504)

  /** JSON-safe primitive, or null to drop the value (non-finite numbers, nested values). */
  private fun primitive(v: Any?): Any? = when (v) {
    null -> JSONObject.NULL
    is String, is Boolean -> v
    is Double -> if (!v.isFinite()) null else if (v % 1.0 == 0.0 && kotlin.math.abs(v) < 9.0E15) v.toLong() else v
    is Float -> if (!v.isFinite()) null else v.toDouble()
    is Number -> v
    else -> null
  }

  /** Context known natively from launch, so events tracked before `init` are complete. */
  private fun baseContext(ctx: Context): JSONObject {
    val info = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0) } catch (_: Exception) { null }
    val build = info?.let {
      if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString() else @Suppress("DEPRECATION") it.versionCode.toString()
    } ?: ""
    return JSONObject()
      .put("app_version", info?.versionName ?: "")
      .put("build", build)
      .put("platform", "android")
      .put("os_version", Build.VERSION.RELEASE ?: "")
      .put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}")
      .put("locale", Locale.getDefault().toLanguageTag())
      .put("sdk_version", SDK_VERSION)
  }

  private fun log(msg: String) {
    if (config?.debug == true) Log.d("shipstat", msg)
  }
}
