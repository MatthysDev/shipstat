import Foundation

struct ShipstatConfig {
  var endpoint: URL
  var headers: [String: String]
  var flushAt: Int
  var flushIntervalMs: Int
  var maxQueueSize: Int
  var debug: Bool
}

/// All state lives on `queue`. Public entry points only enqueue work and return.
final class ShipstatCore {
  static let shared = ShipstatCore()

  private let queue = DispatchQueue(label: "dev.shipstat.core", qos: .utility)
  private lazy var store = EventStore()
  private let defaults = UserDefaults(suiteName: "dev.shipstat") ?? .standard
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
  private var enabled = true
  private var pending = 0
  private var inFlight = false
  private var failures = 0
  private var nextAttemptAt = Date.distantPast
  private var timer: DispatchSourceTimer?
  private var flushWaiters: [() -> Void] = []

  private init() {
    queue.async { self.loadState() }
  }

  // MARK: - Public API (any thread)

  func configure(_ cfg: ShipstatConfig, enabled: Bool, auto: [String: Any]) {
    queue.async {
      self.config = cfg
      self.autoContext = auto
      if self.defaults.object(forKey: "enabled") == nil { self.enabled = enabled }
      self.pending = self.store.count()
      self.startTimer(intervalMs: cfg.flushIntervalMs)
      self.log("init, \(self.pending) waiting event(s)")
      self.flushIfNeeded()
    }
  }

  func track(name: String, props: [String: Any]?, tsMs: Double) {
    queue.async {
      guard self.enabled else { return }
      var ctx = self.context
      for (k, v) in self.autoContext { ctx[k] = v }
      let event: [String: Any] = [
        "id": UUID().uuidString.lowercased(),
        "name": name,
        "ts": self.isoFormatter.string(from: Date(timeIntervalSince1970: tsMs / 1000)),
        "anon_id": self.anonId,
        "user_id": self.userId ?? NSNull(),
        "props": props ?? [:],
        "context": ctx,
      ]
      guard JSONSerialization.isValidJSONObject(event),
            let data = try? JSONSerialization.data(withJSONObject: event),
            let body = String(data: data, encoding: .utf8) else {
        self.log("dropped event \(name): not serializable")
        return
      }
      self.store.insert(body)
      self.pending += 1
      let max = self.config?.maxQueueSize ?? 10_000
      if self.pending > max {
        self.store.trim(to: max)
        self.pending = max
      }
      if self.pending >= (self.config?.flushAt ?? 50) { self.flushIfNeeded() }
    }
  }

  func setContext(_ ctx: [String: Any]) {
    queue.async {
      for (k, v) in ctx { self.context[k] = v }
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

  func setEnabled(_ value: Bool) {
    queue.async {
      self.enabled = value
      self.defaults.set(value, forKey: "enabled")
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

  /// Forces an attempt now, ignoring backoff. `done` runs when it is over.
  func flush(force: Bool = true, done: (() -> Void)? = nil) {
    queue.async {
      if let done = done { self.flushWaiters.append(done) }
      if force { self.nextAttemptAt = .distantPast }
      self.flushIfNeeded(any: true)
    }
  }

  // MARK: - Internals (queue only)

  private func loadState() {
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
    if let data = try? JSONSerialization.data(withJSONObject: context) {
      defaults.set(data, forKey: "context")
    }
  }

  private func startTimer(intervalMs: Int) {
    timer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + .milliseconds(intervalMs), repeating: .milliseconds(intervalMs), leeway: .seconds(1))
    t.setEventHandler { [weak self] in self?.flushIfNeeded(any: true) }
    t.resume()
    timer = t
  }

  private func finishWaiters() {
    let w = flushWaiters
    flushWaiters = []
    w.forEach { $0() }
  }

  private func flushIfNeeded(any: Bool = false) {
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
    req.httpBody = body.data(using: .utf8)
    inFlight = true
    session.dataTask(with: req) { [weak self] _, response, error in
      guard let self = self else { return }
      self.queue.async {
        self.inFlight = false
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil, (200..<300).contains(status) {
          self.store.delete(upTo: last.seq)
          self.pending = max(0, self.pending - rows.count)
          self.failures = 0
          self.log("sent \(rows.count) event(s)")
          if self.pending > 0 { self.flushIfNeeded(any: true); return }
        } else if (400..<500).contains(status), status != 408, status != 429 {
          self.store.delete(upTo: last.seq)
          self.pending = max(0, self.pending - rows.count)
          self.log("dropped \(rows.count) event(s): HTTP \(status)")
        } else {
          self.failures += 1
          var delay = min(300.0, pow(2.0, Double(self.failures)))
          if let h = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After"), let s = Double(h) {
            delay = min(300.0, max(delay, s))
          }
          self.nextAttemptAt = Date().addingTimeInterval(delay)
          self.log("send failed (\(error?.localizedDescription ?? "HTTP \(status)")), retry in \(Int(delay))s")
        }
        self.finishWaiters()
      }
    }.resume()
  }

  private func log(_ msg: String) {
    if config?.debug == true { NSLog("[shipstat] %@", msg) }
  }
}
