package expo.modules.shipstat

import android.content.Context
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
)

/** All state is touched only on [executor]. Public entry points enqueue and return. */
internal class ShipstatCore private constructor(appContext: Context) {
  companion object {
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

  init {
    executor.execute { loadState() }
  }

  // Public API (any thread)

  fun configure(cfg: ShipstatConfig, enabledDefault: Boolean, auto: JSONObject) = executor.execute {
    config = cfg
    autoContext = auto
    if (!prefs.contains("enabled")) enabled = enabledDefault
    pending = store.count()
    timer?.cancel(false)
    timer = executor.scheduleWithFixedDelay({ flushIfNeeded(any = true) }, cfg.flushIntervalMs, cfg.flushIntervalMs, TimeUnit.MILLISECONDS)
    log("init, $pending waiting event(s)")
    flushIfNeeded()
  }

  fun track(name: String, propsJson: String?, tsMs: Double) = executor.execute {
    if (!enabled) return@execute
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
      store.insert(event.toString())
      pending += 1
      // Trim in chunks: once over the cap by 10 % (min 100), drop the oldest back to the cap.
      val maxSize = config?.maxQueueSize ?: 10_000
      if (pending > maxSize + max(100, maxSize / 10)) {
        store.trimTo(maxSize)
        pending = store.count()
      }
      if (pending >= (config?.flushAt ?: 50)) flushIfNeeded()
    } catch (e: Exception) {
      log("dropped event $name: ${e.message}")
    }
  }

  fun setContext(values: Map<String, Any?>) = executor.execute {
    values.forEach { (k, v) -> context.put(k, wrap(v)) }
    prefs.edit().putString("context", context.toString()).apply()
  }

  fun unsetContext(keys: List<String>) = executor.execute {
    keys.forEach { context.remove(it) }
    prefs.edit().putString("context", context.toString()).apply()
  }

  fun identify(id: String?) = executor.execute {
    userId = id
    prefs.edit().putString("userId", id).apply()
  }

  fun setEnabled(value: Boolean) = executor.execute {
    enabled = value
    prefs.edit().putBoolean("enabled", value).apply()
  }

  fun reset() = executor.execute {
    anonId = UUID.randomUUID().toString()
    context = JSONObject()
    userId = null
    prefs.edit().putString("anonId", anonId).remove("userId").putString("context", "{}").apply()
  }

  fun anonymousId(): String = executor.submit<String> { anonId }.get()

  fun flush(force: Boolean = true, done: (() -> Unit)? = null) = executor.execute {
    done?.let { flushWaiters.add(it) }
    if (force) nextAttemptAt = 0L
    flushIfNeeded(any = true)
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

  private fun flushIfNeeded(any: Boolean = false) {
    val cfg = config
    if (cfg == null) { finishWaiters(); return }
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
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        status = conn.responseCode
        retryAfter = conn.getHeaderField("Retry-After")?.toDoubleOrNull()
        (if (status >= 400) conn.errorStream else conn.inputStream)?.close()
        conn.disconnect()
      } catch (e: Exception) {
        error = e.message ?: e.javaClass.simpleName
      }
      executor.execute { onResponse(rows.size, lastSeq, status, retryAfter, error) }
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


  private fun wrap(v: Any?): Any = when (v) {
    null -> JSONObject.NULL
    is List<*> -> JSONArray().also { a -> v.forEach { a.put(wrap(it)) } }
    is Double -> if (v % 1.0 == 0.0 && kotlin.math.abs(v) < 9.0E15) v.toLong() else v
    else -> v
  }

  private fun log(msg: String) {
    if (config?.debug == true) Log.d("shipstat", msg)
  }
}
