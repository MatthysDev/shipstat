import Foundation
import Network

/// A real HTTP endpoint on 127.0.0.1: records every request it gets and answers from a script
/// (200 once the script is empty).
final class TestServer {
  enum Answer {
    case status(Int)
    /// Close the connection without answering, like a network that drops.
    case drop
  }

  struct Request {
    let headers: [String: String]
    let raw: Data
    /// What the server answered, 0 for a dropped connection.
    let status: Int
    var gzipped: Bool { headers["content-encoding"] == "gzip" }
    var json: [String: Any] {
      let data = gzipped ? gunzip(raw) : raw
      return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
    var events: [[String: Any]] { json["events"] as? [[String: Any]] ?? [] }
  }

  private let listener: NWListener
  private let lock = NSLock()
  private var received: [Request] = []
  private var script: [Answer] = []
  private(set) var port: UInt16 = 0
  var url: URL { URL(string: "http://127.0.0.1:\(port)/events")! }

  init() {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
    listener = try! NWListener(using: params)
    let ready = DispatchSemaphore(value: 0)
    listener.stateUpdateHandler = { state in
      if case .ready = state { ready.signal() }
    }
    listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
    listener.start(queue: .global())
    _ = ready.wait(timeout: .now() + 5)
    port = listener.port?.rawValue ?? 0
  }

  deinit { listener.cancel() }

  var requests: [Request] {
    lock.lock()
    defer { lock.unlock() }
    return received
  }

  /// Events the server accepted (2xx), in the order it got them.
  var delivered: [[String: Any]] {
    requests.filter { (200..<300).contains($0.status) }.flatMap { $0.events }
  }

  func reply(_ answers: Answer...) {
    lock.lock()
    script += answers
    lock.unlock()
  }

  /// Waits until at least `count` requests arrived.
  @discardableResult
  func waitFor(requests count: Int, timeout: TimeInterval = 5) -> Bool {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if requests.count >= count { return true }
      Thread.sleep(forTimeInterval: 0.02)
    }
    return requests.count >= count
  }

  private final class Buffer { var data = Data() }

  private func handle(_ connection: NWConnection) {
    connection.start(queue: .global())
    let buffer = Buffer()
    func read() {
      connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { data, _, done, error in
        if let data = data { buffer.data.append(data) }
        if let (headers, body) = Self.parse(buffer.data) {
          self.answer(headers: headers, body: body, on: connection)
        } else if done || error != nil {
          connection.cancel()
        } else {
          read()
        }
      }
    }
    read()
  }

  private func answer(headers: [String: String], body: Data, on connection: NWConnection) {
    lock.lock()
    let next = script.isEmpty ? Answer.status(200) : script.removeFirst()
    switch next {
    case .drop:
      received.append(Request(headers: headers, raw: body, status: 0))
      lock.unlock()
      connection.cancel()
    case .status(let code):
      received.append(Request(headers: headers, raw: body, status: code))
      lock.unlock()
      let response = "HTTP/1.1 \(code) Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
  }

  /// Headers (lowercased names) and body once a whole request is in `data`.
  static func parse(_ data: Data) -> ([String: String], Data)? {
    guard let end = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let head = String(decoding: data[data.startIndex..<end.lowerBound], as: UTF8.self)
    var headers: [String: String] = [:]
    for line in head.components(separatedBy: "\r\n").dropFirst() {
      guard let colon = line.firstIndex(of: ":") else { continue }
      headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let length = Int(headers["content-length"] ?? "0") ?? 0
    let body = data[end.upperBound...]
    guard body.count >= length else { return nil }
    return (headers, Data(body.prefix(length)))
  }
}

/// Decodes with the system gzip, not the SDK's own code.
func gunzip(_ data: Data) -> Data {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
  process.arguments = ["-dc"]
  let input = Pipe()
  let output = Pipe()
  process.standardInput = input
  process.standardOutput = output
  guard (try? process.run()) != nil else { return Data() }
  input.fileHandleForWriting.write(data)
  try? input.fileHandleForWriting.close()
  let out = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  return process.terminationStatus == 0 ? out : Data()
}
