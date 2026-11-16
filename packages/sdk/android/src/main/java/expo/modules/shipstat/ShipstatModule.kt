package expo.modules.shipstat

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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
        compress = cfg["compress"] as? Boolean ?: false,
      )
      val extra = buildMap {
        (cfg["sdkVersion"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("sdk_version", it) }
        (cfg["ota"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("ota", it) }
      }
      core.configure(config, cfg["enabled"] as? Boolean ?: true, extra)
    }

    Function("track") { name: String, propsJson: String?, tsMs: Double ->
      core.track(name, propsJson, tsMs)
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
}
