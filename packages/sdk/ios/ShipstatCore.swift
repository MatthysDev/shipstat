import Foundation

struct ShipstatConfig {
  var endpoint: URL
  var headers: [String: String]
  var flushAt: Int
  var flushIntervalMs: Int
  var maxQueueSize: Int
  var debug: Bool
  var compress: Bool
}

/// All state lives on `queue`. Public entry points only enqueue work and return.
final class ShipstatCore {
  static let shared = ShipstatCore()

  private let queue = DispatchQueue(label: "dev.shipstat.core", qos: .utility)
  private let directory: URL?
  private lazy var store = EventStore(directory: directory)
  private let defaults: UserDefaults
  private let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 30
    c.waitsForConnectivity = false
    return URLSession(configuration: c)
  }()
  private let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  private var config: ShipstatConfig?
  private var autoContext: [String: Any] = [:]
  private var context: [String: Any] = [:]
  private var anonId = ""
  private var userId: String?
  /// Persisted opt-out wins; otherwise `init({ enabled })` decides and purges if false.
  private var enabled = true
  private var pending = 0
  private var inFlight = false
  private var failures = 0
  private var nextAttemptAt = Date.distantPast
  /// One-shot: armed only while events wait, so an idle app never wakes up for Shipstat.
  private var timer: DispatchSourceTimer?
  /// Whether the endpoint reads gzip bodies, learned from its answers during this session.
  private enum GzipSupport { case untested, accepted, refused }
  private var gzipSupport = GzipSupport.untested
  /// True while the plain-JSON resend that follows a refused gzip batch is in flight.
  private var probingPlain = false
  private var flushWaiters: [() -> Void] = []
  /// Events serialized but not yet on disk. Drained on the next turn of the queue, so a burst
  /// of track() calls becomes one SQLite transaction instead of one per event.
  private var writeBuffer: [String] = []

  /// The app uses `shared`; tests open their own core on a separate folder and defaults suite.
  init(directory: URL? = nil, defaults: UserDefaults? = nil) {
    self.directory = directory
    self.defaults = defaults ?? UserDefaults(suiteName: "dev.shipstat") ?? .standard
    queue.async { self.loadState() }
  }

  // MARK: - Public API (any thread)

  /// `extra` holds the context keys only JavaScript knows (sdk_version, ota).
  func configure(_ cfg: ShipstatConfig, enabled: Bool, extra: [String: Any]) {
    queue.async {
      self.config = cfg
      for (k, v) in extra { self.autoContext[k] = v }
      if self.defaults.object(forKey: "enabled") == nil, !enabled {
        // Disabled from the start: drop what was tracked before init.
        self.enabled = false
        self.store.clear()
      }
      self.pending = self.store.count()
      self.cancelTimer()
      self.log("init, \(self.pending) waiting event(s)")
      self.flushIfNeeded()
      self.armTimer()
    }
  }

  func track(name: String, propsJson: String?, tsMs: Double) {
    queue.async {
      guard self.enabled else { return }
      var props: [String: Any] = [:]
      if let json = propsJson, let data = json.data(using: .utf8),
         let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        props = obj
      }
      var ctx = self.context
      for (k, v) in self.autoContext { ctx[k] = v }
      let event: [String: Any] = [
        "id": UUID().uuidString.lowercased(),
        "name": name,
        "ts": self.isoFormatter.string(from: Date(timeIntervalSince1970: tsMs / 1000)),
        "anon_id": self.anonId,
        "user_id": self.userId ?? NSNull(),
        "props": props,
        "context": ctx,
      ]
      guard JSONSerialization.isValidJSONObject(event),
            let data = try? JSONSerialization.data(withJSONObject: event),
            let body = String(data: data, encoding: .utf8) else {
        self.log("dropped event \(name): not serializable")
        return
      }
      self.writeBuffer.append(body)
      if self.writeBuffer.count == 1 {
        self.queue.async { self.drainWrites() }
      }
    }
  }

  func setContext(_ ctx: [String: Any]) {
    queue.async {
      for (k, v) in Self.sanitize(ctx) { self.context[k] = v }
      self.saveContext()
    }
  }

  func unsetContext(_ keys: [String]) {
    queue.async {
      keys.forEach { self.context.removeValue(forKey: $0) }
      self.saveContext()
    }
  }

  func identify(_ id: String?) {
    queue.async {
      self.userId = id
      self.defaults.set(id, forKey: "userId")
    }
  }

  /// Opt-out also deletes what is waiting, so nothing tracked before is sent afterwards.
  func setEnabled(_ value: Bool) {
    queue.async {
      self.enabled = value
      self.defaults.set(value, forKey: "enabled")
      if !value {
        self.writeBuffer.removeAll()
        self.store.clear()
        self.pending = 0
        self.cancelTimer()
      }
    }
  }

  func reset() {
    queue.async {
      self.anonId = UUID().uuidString.lowercased()
      self.defaults.set(self.anonId, forKey: "anonId")
      self.context = [:]
      self.userId = nil
      self.defaults.removeObject(forKey: "userId")
      self.saveContext()
    }
  }

  func anonymousId() -> String {
    queue.sync { anonId }
  }

  /// Events on the device that have not been sent yet.
  func waitingCount() -> Int {
    queue.sync { pending + writeBuffer.count }
  }

  /// Forces an attempt now, ignoring backoff. `done` runs when it is over.
  func flush(force: Bool = true, done: (() -> Void)? = nil) {
    queue.async {
      if let done = done { self.flushWaiters.append(done) }
      if force { self.nextAttemptAt = .distantPast }
      self.flushIfNeeded(any: true)
    }
  }

  // MARK: - Internals (queue only)

  /// Keeps JSON-safe primitives only: non-finite numbers and nested values are dropped.
  static func sanitize(_ dict: [String: Any]) -> [String: Any] {
    dict.filter { _, v in
      if v is NSNull || v is String { return true }
      if let n = v as? NSNumber { return n.doubleValue.isFinite }
      return false
    }
  }

  /// Context known natively from launch, so events tracked before `init` are complete.
  static func baseContext() -> [String: Any] {
    let info = Bundle.main.infoDictionary ?? [:]
    let v = ProcessInfo.processInfo.operatingSystemVersion
    var sys = utsname()
    uname(&sys)
    let machine = withUnsafePointer(to: &sys.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
    // On the simulator `machine` is the host arch; the simulated model is in the environment.
    let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
    return [
      "app_version": info["CFBundleShortVersionString"] as? String ?? "",
      "build": info["CFBundleVersion"] as? String ?? "",
      "platform": "ios",
      "os_version": "\(v.majorVersion).\(v.minorVersion)" + (v.patchVersion > 0 ? ".\(v.patchVersion)" : ""),
      "device_model": model,
      "locale": Locale.preferredLanguages.first ?? Locale.current.identifier,
      "sdk_version": sdkVersion,
    ]
  }

  static let sdkVersion = "0.1.0"

  private func loadState() {
    autoContext = Self.baseContext()
    if let id = defaults.string(forKey: "anonId") {
      anonId = id
    } else {
      anonId = UUID().uuidString.lowercased()
      defaults.set(anonId, forKey: "anonId")
    }
    userId = defaults.string(forKey: "userId")
    if defaults.object(forKey: "enabled") != nil { enabled = defaults.bool(forKey: "enabled") }
    if let data = defaults.data(forKey: "context"),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      context = obj
    }
  }

  private func saveContext() {
    guard JSONSerialization.isValidJSONObject(context) else { return }
    if let data = try? JSONSerialization.data(withJSONObject: context) {
      defaults.set(data, forKey: "context")
    }
  }

  /// Wakes up once, `afterMs` from now (default: the flush interval), if events are waiting.
  /// A 10 % leeway lets the system batch this wake-up with others.
  private func armTimer(afterMs: Int? = nil) {
    guard let cfg = config, enabled, pending > 0 || !writeBuffer.isEmpty else { return }
    if afterMs == nil, timer != nil { return }
    cancelTimer()
    let ms = afterMs ?? cfg.flushIntervalMs
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + .milliseconds(ms), leeway: .milliseconds(Swift.max(1000, ms / 10)))
    t.setEventHandler { [weak self] in
      guard let self = self else { return }
      self.cancelTimer()
      self.flushIfNeeded(any: true)
      self.armTimer()
    }
    t.resume()
    timer = t
  }

  private func cancelTimer() {
    timer?.cancel()
    timer = nil
  }

  private func finishWaiters() {
    let w = flushWaiters
    flushWaiters = []
    w.forEach { $0() }
  }

  /// Writes buffered events in one transaction. `thenFlush` is false when called by a flush.
  private func drainWrites(thenFlush: Bool = true) {
    guard !writeBuffer.isEmpty else { return }
    let batch = writeBuffer
    writeBuffer.removeAll(keepingCapacity: true)
    store.insert(batch)
    pending += batch.count
    // Trim in chunks: once over the cap by 10 % (min 100), drop the oldest back to the cap.
    let cap = config?.maxQueueSize ?? 10_000
    if pending > cap + Swift.max(100, cap / 10) {
      store.trim(to: cap)
      pending = store.count()
    }
    if thenFlush {
      if pending >= (config?.flushAt ?? 50) { flushIfNeeded() }
      armTimer()
    }
  }

  private func flushIfNeeded(any: Bool = false) {
    drainWrites(thenFlush: false)
    guard enabled else {
      finishWaiters()
      return
    }
    guard let cfg = config, !inFlight else {
      if config == nil { finishWaiters() }
      return
    }
    guard pending > 0, any || pending >= cfg.flushAt, Date() >= nextAttemptAt else {
      finishWaiters()
      return
    }
    let rows = store.peek(limit: max(cfg.flushAt, 1) * 2)
    guard let last = rows.last else {
      pending = 0
      finishWaiters()
      return
    }
    let body = "{\"schema\":1,\"sent_at\":\"\(isoFormatter.string(from: Date()))\",\"events\":[" + rows.map { $0.body }.joined(separator: ",") + "]}"
    var req = URLRequest(url: cfg.endpoint)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    cfg.headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
    let raw = Data(body.utf8)
    var gzipped = false
    if cfg.compress, gzipSupport != .refused, let gz = Gzip.compress(raw) {
      req.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
      req.httpBody = gz
      gzipped = true
    } else {
      req.httpBody = raw
    }
    inFlight = true
    session.dataTask(with: req) { [weak self] _, response, error in
      guard let self = self else { return }
      self.queue.async {
        self.inFlight = false
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if self.probingPlain, !gzipped, status > 0 {
          // Plain JSON failed too: gzip was not the problem, keep compressing.
          self.probingPlain = false
          if !(200..<300).contains(status) { self.gzipSupport = .accepted }
        }
        if error == nil, (200..<300).contains(status) {
          if gzipped { self.gzipSupport = .accepted }
          self.store.delete(upTo: last.seq)
          self.pending = self.store.count()
          self.failures = 0
          self.log("sent \(rows.count) event(s)")
          if self.pending > 0 { self.flushIfNeeded(any: true); return }
          self.cancelTimer()
        } else if gzipped, self.gzipSupport == .untested, Self.mayRejectGzip(status) {
          // Some endpoints cannot read gzip bodies: resend this batch as plain JSON right away,
          // once per session.
          self.gzipSupport = .refused
          self.probingPlain = true
          self.log("endpoint refused a gzipped batch (HTTP \(status)), sending plain JSON from now on")
          self.flushIfNeeded(any: true)
          return
        } else if (400..<500).contains(status), status != 408, status != 429 {
          self.store.delete(upTo: last.seq)
          self.pending = self.store.count()
          self.log("dropped \(rows.count) event(s): HTTP \(status)")
        } else {
          self.failures += 1
          var delay = min(300.0, pow(2.0, Double(self.failures)))
          if let h = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After"), let s = Double(h) {
            delay = min(300.0, max(delay, s))
          }
          // Never retry sooner than the flush interval: an offline phone stays asleep.
          delay = Swift.max(delay, Double(cfg.flushIntervalMs) / 1000)
          self.nextAttemptAt = Date().addingTimeInterval(delay)
          self.armTimer(afterMs: Int(delay * 1000))
          self.log("send failed (\(error?.localizedDescription ?? "HTTP \(status)")), retry in \(Int(delay))s")
        }
        self.finishWaiters()
      }
    }.resume()
  }

  /// An HTTP error that may mean "cannot read gzip" rather than "bad events" or "server down".
  static func mayRejectGzip(_ status: Int) -> Bool {
    status >= 400 && ![401, 403, 408, 429, 502, 503, 504].contains(status)
  }

  private func log(_ msg: String) {
    if config?.debug == true { NSLog("[shipstat] %@", msg) }
  }
}
