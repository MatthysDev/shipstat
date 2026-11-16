package expo.modules.shipstat

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

/** All state is touched only on [executor]. Public entry points enqueue and return. */
internal class ShipstatCore private constructor(appContext: Context) {
  companion object {
    const val SDK_VERSION = "0.1.0"

    @Volatile private var instance: ShipstatCore? = null
    fun get(context: Context): ShipstatCore =
      instance ?: synchronized(this) { instance ?: ShipstatCore(context.applicationContext).also { instance = it } }
  }

  private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "shipstat").apply { priority = Thread.MIN_PRIORITY; isDaemon = true }
  }
  private val network = Executors.newSingleThreadExecutor { r -> Thread(r, "shipstat-net").apply { isDaemon = true } }
  private val prefs = appContext.getSharedPreferences("dev.shipstat", Context.MODE_PRIVATE)
  private val store by lazy { EventStore(appContext) }
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
  private var timer: ScheduledFuture<*>? = null
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
    extra.forEach { (k, v) -> autoContext.put(k, v) }
    if (!prefs.contains("enabled") && !enabledDefault) {
      // Disabled from the start: drop what was tracked before init.
      enabled = false
      store.clear()
    }
    pending = store.count()
    timer?.cancel(false)
    // A periodic task that throws is cancelled for good: keep it exception-free.
    timer = executor.scheduleWithFixedDelay({
      try {
        flushIfNeeded(any = true)
      } catch (e: Exception) {
        Log.w("shipstat", "flush failed: ${e.message}")
      }
    }, cfg.flushIntervalMs, cfg.flushIntervalMs, TimeUnit.MILLISECONDS)
    log("init, $pending waiting event(s)")
    flushIfNeeded()
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
    }
  }

  fun reset() = run {
    anonId = UUID.randomUUID().toString()
    context = JSONObject()
    userId = null
    prefs.edit().putString("anonId", anonId).remove("userId").putString("context", "{}").apply()
  }

  fun anonymousId(): String = executor.submit<String> { anonId }.get()

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

  private fun loadState() {
    anonId = prefs.getString("anonId", null) ?: UUID.randomUUID().toString().also {
      prefs.edit().putString("anonId", it).apply()
    }
    userId = prefs.getString("userId", null)
    if (prefs.contains("enabled")) enabled = prefs.getBoolean("enabled", true)
    context = try { JSONObject(prefs.getString("context", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
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
    if (thenFlush && pending >= (config?.flushAt ?: 50)) flushIfNeeded()
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
        if (cfg.compress) {
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
          onResponse(rows.size, lastSeq, status, retryAfter, error)
        } catch (e: Exception) {
          inFlight = false
          finishWaiters()
          Log.w("shipstat", "send bookkeeping failed: ${e.message}")
        }
      }
    }
  }

  private fun onResponse(count: Int, lastSeq: Long, status: Int, retryAfter: Double?, error: String?) {
    inFlight = false
    if (error == null && status in 200..299) {
      store.deleteUpTo(lastSeq)
      pending = store.count()
      failures = 0
      log("sent $count event(s)")
      if (pending > 0) { flushIfNeeded(any = true); return }
    } else if (error == null && status in 400..499 && status != 408 && status != 429) {
      store.deleteUpTo(lastSeq)
      pending = store.count()
      log("dropped $count event(s): HTTP $status")
    } else {
      failures += 1
      var delay = min(300.0, 2.0.pow(failures))
      if (retryAfter != null) delay = min(300.0, max(delay, retryAfter))
      nextAttemptAt = System.currentTimeMillis() + (delay * 1000).toLong()
      log("send failed (${error ?: "HTTP $status"}), retry in ${delay.toInt()}s")
    }
    finishWaiters()
  }


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
