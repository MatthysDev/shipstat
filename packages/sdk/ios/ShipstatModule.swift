import ExpoModulesCore
import UIKit

public class ShipstatModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Shipstat")

    Function("init") { (cfg: [String: Any]) in
      guard let endpointString = cfg["endpoint"] as? String, let endpoint = URL(string: endpointString) else { return }
      let config = ShipstatConfig(
        endpoint: endpoint,
        headers: cfg["headers"] as? [String: String] ?? [:],
        flushAt: (cfg["flushAt"] as? NSNumber)?.intValue ?? 50,
        flushIntervalMs: (cfg["flushIntervalMs"] as? NSNumber)?.intValue ?? 30_000,
        maxQueueSize: (cfg["maxQueueSize"] as? NSNumber)?.intValue ?? 10_000,
        debug: cfg["debug"] as? Bool ?? false,
        compress: cfg["compress"] as? Bool ?? true
      )
      var extra: [String: Any] = [:]
      if let sdk = cfg["sdkVersion"] as? String, !sdk.isEmpty { extra["sdk_version"] = sdk }
      if let ota = cfg["ota"] as? String, !ota.isEmpty { extra["ota"] = ota }
      ShipstatCore.shared.configure(config, enabled: cfg["enabled"] as? Bool ?? true, extra: extra)
    }

    Function("track") { (name: String, propsJson: String?, tsMs: Double) in
      ShipstatCore.shared.track(name: name, propsJson: propsJson, tsMs: tsMs)
    }

    Function("setContext") { (ctx: [String: Any]) in
      ShipstatCore.shared.setContext(ctx)
    }

    Function("unsetContext") { (keys: [String]) in
      ShipstatCore.shared.unsetContext(keys)
    }

    Function("identify") { (userId: String?) in
      ShipstatCore.shared.identify(userId)
    }

    Function("setEnabled") { (enabled: Bool) in
      ShipstatCore.shared.setEnabled(enabled)
    }

    Function("reset") {
      ShipstatCore.shared.reset()
    }

    Function("getAnonId") { () -> String in
      ShipstatCore.shared.anonymousId()
    }

    AsyncFunction("flush") { (promise: Promise) in
      ShipstatCore.shared.flush { promise.resolve(nil) }
    }

    OnAppEntersBackground {
      var task: UIBackgroundTaskIdentifier = .invalid
      task = UIApplication.shared.beginBackgroundTask(withName: "shipstat-flush") {
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
      }
      ShipstatCore.shared.flush(force: false) {
        DispatchQueue.main.async {
          if task != .invalid {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
          }
        }
      }
    }
  }
}
