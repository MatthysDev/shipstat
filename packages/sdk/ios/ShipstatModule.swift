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
        flushIntervalMs: (cfg["flushIntervalMs"] as? NSNumber)?.intValue ?? 10_000,
        maxQueueSize: (cfg["maxQueueSize"] as? NSNumber)?.intValue ?? 10_000,
        debug: cfg["debug"] as? Bool ?? false
      )
      ShipstatCore.shared.configure(config, enabled: cfg["enabled"] as? Bool ?? true, auto: Self.autoContext(cfg))
    }

    Function("track") { (name: String, props: [String: Any]?, tsMs: Double) in
      ShipstatCore.shared.track(name: name, props: props, tsMs: tsMs)
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

  private static func autoContext(_ cfg: [String: Any]) -> [String: Any] {
    let info = Bundle.main.infoDictionary ?? [:]
    let v = ProcessInfo.processInfo.operatingSystemVersion
    var sys = utsname()
    uname(&sys)
    let machine = withUnsafePointer(to: &sys.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
    // On the simulator `machine` is the host arch; the simulated model is in the environment.
    let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
    var ctx: [String: Any] = [
      "app_version": info["CFBundleShortVersionString"] as? String ?? "",
      "build": info["CFBundleVersion"] as? String ?? "",
      "platform": "ios",
      "os_version": "\(v.majorVersion).\(v.minorVersion)" + (v.patchVersion > 0 ? ".\(v.patchVersion)" : ""),
      "device_model": model,
      "locale": Locale.preferredLanguages.first ?? Locale.current.identifier,
      "sdk_version": cfg["sdkVersion"] as? String ?? "",
    ]
    if let ota = cfg["ota"] as? String, !ota.isEmpty { ctx["ota"] = ota }
    return ctx
  }
}
