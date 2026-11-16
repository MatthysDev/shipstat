package expo.modules.shipstat

import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.Locale

class ShipstatModule : Module() {
  private val core: ShipstatCore
    get() = ShipstatCore.get(appContext.reactContext ?: throw Exceptions.ReactContextLost())

  override fun definition() = ModuleDefinition {
    Name("Shipstat")

    Function("init") { cfg: Map<String, Any?> ->
      val endpoint = cfg["endpoint"] as? String ?: return@Function
      @Suppress("UNCHECKED_CAST")
      val config = ShipstatConfig(
        endpoint = endpoint,
        headers = (cfg["headers"] as? Map<String, Any?>)?.mapValues { it.value.toString() } ?: emptyMap(),
        flushAt = (cfg["flushAt"] as? Number)?.toInt() ?: 50,
        flushIntervalMs = (cfg["flushIntervalMs"] as? Number)?.toLong() ?: 10_000L,
        maxQueueSize = (cfg["maxQueueSize"] as? Number)?.toInt() ?: 10_000,
        debug = cfg["debug"] as? Boolean ?: false,
      )
      core.configure(config, cfg["enabled"] as? Boolean ?: true, autoContext(cfg))
    }

    Function("track") { name: String, props: Map<String, Any?>?, tsMs: Double ->
      core.track(name, props, tsMs)
    }

    Function("setContext") { ctx: Map<String, Any?> -> core.setContext(ctx) }

    Function("unsetContext") { keys: List<String> -> core.unsetContext(keys) }

    Function("identify") { userId: String? -> core.identify(userId) }

    Function("setEnabled") { enabled: Boolean -> core.setEnabled(enabled) }

    Function("reset") { core.reset() }

    Function("getAnonId") { core.anonymousId() }

    AsyncFunction("flush") { promise: Promise ->
      core.flush { promise.resolve(null) }
    }

    OnActivityEntersBackground {
      core.flush(force = false)
    }
  }

  private fun autoContext(cfg: Map<String, Any?>): JSONObject {
    val ctx = appContext.reactContext
    val info = ctx?.let {
      try { it.packageManager.getPackageInfo(it.packageName, 0) } catch (_: Exception) { null }
    }
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
      .put("sdk_version", cfg["sdkVersion"] as? String ?: "")
      .apply { (cfg["ota"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("ota", it) } }
  }
}
