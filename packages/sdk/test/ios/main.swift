import Foundation

// The native core, run on the Mac against a real local HTTP server. No simulator needed:
// ShipstatCore only uses Foundation, SQLite and Compression. Run with test/ios/run.sh.

var failures = 0
var ran = 0

func expect(_ ok: @autoclosure () -> Bool, _ what: String, line: Int = #line) {
  if !ok() {
    failures += 1
    print("    ✗ \(what) (main.swift:\(line))")
  }
}

func test(_ name: String, _ body: () -> Void) {
  let before = failures
  ran += 1
  let start = Date()
  body()
  let ms = Int(Date().timeIntervalSince(start) * 1000)
  print(failures == before ? "  ok   \(name) (\(ms) ms)" : "  FAIL \(name)")
}

/// One app install: its folder and its defaults survive `open()` calls, like a relaunch.
final class Install {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shipstat-test-\(UUID().uuidString)")
  let suite = "dev.shipstat.test.\(UUID().uuidString)"
  func open() -> ShipstatCore { ShipstatCore(directory: dir, defaults: UserDefaults(suiteName: suite)!) }
  deinit {
    try? FileManager.default.removeItem(at: dir)
    UserDefaults.standard.removePersistentDomain(forName: suite)
  }
}

func config(_ server: TestServer, flushAt: Int = 50, intervalMs: Int = 60_000, maxQueue: Int = 10_000, compress: Bool = true) -> ShipstatConfig {
  ShipstatConfig(endpoint: server.url, headers: ["Authorization": "Bearer test"], flushAt: flushAt, flushIntervalMs: intervalMs, maxQueueSize: maxQueue, debug: false, compress: compress)
}

func track(_ core: ShipstatCore, _ name: String, _ i: Int = 0) {
  core.track(name: name, propsJson: "{\"i\":\(i)}", tsMs: Date().timeIntervalSince1970 * 1000)
}

/// Sends now and waits for the attempt (and any resend it triggers) to be over.
func flushNow(_ core: ShipstatCore) {
  let done = DispatchSemaphore(value: 0)
  core.flush { done.signal() }
  _ = done.wait(timeout: .now() + 10)
}

/// Waits for buffered track() calls to reach the disk: they are written one queue turn later.
func settled(_ core: ShipstatCore) -> Int {
  _ = core.waitingCount()
  return core.waitingCount()
}

func names(_ events: [[String: Any]]) -> [String] { events.compactMap { $0["name"] as? String } }
func ctx(_ event: [String: Any]) -> [String: Any] { event["context"] as? [String: Any] ?? [:] }

print("ShipstatCore (iOS)")

test("sends a full batch on its own, gzipped, in the documented format") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server, flushAt: 3), enabled: true, extra: ["ota": "update-1"])
  (0..<3).forEach { track(core, "opened", $0) }
  expect(server.waitFor(requests: 1), "a request arrives without flush()")
  guard let req = server.requests.first else { return }
  expect(req.gzipped, "body is gzipped")
  expect(req.headers["authorization"] == "Bearer test", "custom headers are sent")
  expect(req.headers["content-type"] == "application/json", "content type")
  expect(req.json["schema"] as? Int == 1, "schema 1")
  expect(req.json["sent_at"] is String, "sent_at")
  let events = req.events
  expect(events.count == 3, "3 events, got \(events.count)")
  expect(Set(events.compactMap { $0["id"] as? String }).count == 3, "unique ids")
  let e = events.first ?? [:]
  expect((e["id"] as? String)?.count == 36, "uuid id")
  expect((e["ts"] as? String)?.range(of: #"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$"#, options: .regularExpression) != nil, "ISO ts with ms: \(e["ts"] ?? "")")
  expect(!((e["anon_id"] as? String) ?? "").isEmpty, "anon_id")
  expect(e["user_id"] is NSNull, "user_id null")
  expect((e["props"] as? [String: Any])?["i"] as? Int == 0, "props")
  expect(ctx(e)["platform"] as? String == "ios", "platform")
  expect(ctx(e)["sdk_version"] as? String == ShipstatCore.sdkVersion, "sdk_version")
  expect(ctx(e)["ota"] as? String == "update-1", "extra context from JS")
  expect(ctx(e)["app_version"] != nil && ctx(e)["os_version"] != nil && ctx(e)["device_model"] != nil, "device context")
  expect(core.waitingCount() == 0, "queue empty after a 200")
}

test("keeps events tracked before init") {
  let server = TestServer(), install = Install(), core = install.open()
  track(core, "early", 1)
  track(core, "early", 2)
  core.configure(config(server), enabled: true, extra: [:])
  flushNow(core)
  expect(names(server.delivered) == ["early", "early"], "both early events sent")
}

test("sends after the interval, then never wakes up while idle") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server, intervalMs: 300), enabled: true, extra: [:])
  track(core, "one")
  expect(server.waitFor(requests: 1, timeout: 3), "sent once the interval passed")
  Thread.sleep(forTimeInterval: 1.5)
  expect(server.requests.count == 1, "no request while nothing waits, got \(server.requests.count)")
}

test("resends as plain JSON once when gzip is refused, and stays plain") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  server.reply(.status(415))
  track(core, "a")
  track(core, "b")
  flushNow(core)
  track(core, "c")
  flushNow(core)
  let r = server.requests
  expect(r.count == 3, "3 requests, got \(r.count)")
  expect(r.map { $0.gzipped } == [true, false, false], "gzip, then plain: \(r.map { $0.gzipped })")
  expect(names(server.delivered) == ["a", "b", "c"], "every event once: \(names(server.delivered))")
}

test("keeps compressing when plain JSON fails too") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  server.reply(.status(400), .status(400))
  track(core, "bad")
  flushNow(core)
  expect(core.waitingCount() == 0, "a batch the server rejects is dropped")
  track(core, "next")
  flushNow(core)
  let r = server.requests
  expect(r.map { $0.gzipped } == [true, false, true], "gzip, plain probe, gzip again: \(r.map { $0.gzipped })")
}

test("keeps events while the server fails, sends them on the next try") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  server.reply(.status(503))
  track(core, "a")
  track(core, "b")
  flushNow(core)
  expect(core.waitingCount() == 2, "kept after a 503")
  flushNow(core)
  expect(names(server.delivered) == ["a", "b"], "delivered once the server is back")
  expect(core.waitingCount() == 0, "queue empty")
}

test("keeps events through a dropped connection") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  server.reply(.drop)
  track(core, "a")
  flushNow(core)
  expect(core.waitingCount() == 1, "kept after a network error")
  flushNow(core)
  expect(names(server.delivered) == ["a"], "delivered on the next try")
}

test("opt-out deletes waiting events, sends nothing, and survives a relaunch") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  track(core, "a")
  _ = settled(core)
  core.setEnabled(false)
  track(core, "b")
  flushNow(core)
  expect(core.waitingCount() == 0, "nothing waits")
  let again = install.open()
  again.configure(config(server), enabled: true, extra: [:])
  track(again, "c")
  flushNow(again)
  expect(server.requests.isEmpty, "nothing sent, got \(server.requests.count) request(s)")
  again.setEnabled(true)
  track(again, "d")
  flushNow(again)
  expect(names(server.delivered) == ["d"], "opting back in sends only new events: \(names(server.delivered))")
}

test("caps the queue and keeps the newest events") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server, flushAt: 1000, maxQueue: 100), enabled: true, extra: [:])
  (0..<250).forEach { track(core, "e", $0) }
  let waiting = settled(core)
  expect(waiting >= 100 && waiting <= 110, "about 100 waiting, got \(waiting)")
  flushNow(core)
  let ids = server.delivered.compactMap { ($0["props"] as? [String: Any])?["i"] as? Int }
  expect(ids.last == 249, "newest kept")
  expect((ids.first ?? 0) >= 140, "oldest dropped, first is \(ids.first ?? -1)")
}

test("context, user id and anonymous id persist across a relaunch") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  core.setContext(["variant": "b", "nested": ["x": 1], "bad": Double.nan])
  core.identify("u1")
  track(core, "a")
  core.unsetContext(["variant"])
  track(core, "b")
  core.setContext(["feature": "paywall"])
  flushNow(core)
  let d = server.delivered
  expect(d.count == 2, "2 events")
  if d.count == 2 {
    expect(ctx(d[0])["variant"] as? String == "b", "context tag")
    expect(ctx(d[0])["nested"] == nil && ctx(d[0])["bad"] == nil, "nested and NaN values dropped")
    expect(d[0]["user_id"] as? String == "u1", "user id")
    expect(ctx(d[1])["variant"] == nil, "unset tag gone")
  }
  let anon = core.anonymousId()
  let again = install.open()
  expect(again.anonymousId() == anon, "same anonymous id after relaunch")
  again.configure(config(server), enabled: true, extra: [:])
  track(again, "c")
  flushNow(again)
  let c = server.delivered.last ?? [:]
  expect(c["user_id"] as? String == "u1", "user id kept")
  expect(ctx(c)["feature"] as? String == "paywall", "context kept")
}

test("events tracked before a crash are sent on the next launch") {
  let server = TestServer(), install = Install(), first = install.open()
  (0..<3).forEach { track(first, "before", $0) }
  _ = settled(first)
  let next = install.open()
  next.configure(config(server), enabled: true, extra: [:])
  flushNow(next)
  expect(server.delivered.count == 3, "3 events from the previous launch, got \(server.delivered.count)")
}

test("reset gives a new anonymous id and forgets the user") {
  let server = TestServer(), install = Install(), core = install.open()
  core.configure(config(server), enabled: true, extra: [:])
  core.identify("u1")
  let before = core.anonymousId()
  core.reset()
  expect(core.anonymousId() != before, "new anonymous id")
  track(core, "a")
  flushNow(core)
  expect(server.delivered.first?["user_id"] is NSNull, "no user id")
}

test("only errors that may mean 'no gzip' trigger the plain resend") {
  expect(ShipstatCore.mayRejectGzip(400) && ShipstatCore.mayRejectGzip(415) && ShipstatCore.mayRejectGzip(500), "400, 415, 500")
  expect(![401, 403, 408, 429, 502, 503, 504, 200].contains(where: ShipstatCore.mayRejectGzip), "auth, throttling, outages")
}

print(failures == 0 ? "\(ran) passed" : "\(failures) failed check(s)")
exit(failures == 0 ? 0 : 1)
