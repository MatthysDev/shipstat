import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Persistent FIFO of serialized events. Only used from ShipstatCore's serial queue.
final class EventStore {
  private var db: OpaquePointer?

  init() {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("shipstat", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var url = dir.appendingPathComponent("events.sqlite")
    if sqlite3_open(url.path, &db) != SQLITE_OK {
      db = nil
      return
    }
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
    exec("PRAGMA journal_mode=WAL;")
    exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);")
  }

  deinit { sqlite3_close(db) }

  @discardableResult
  private func exec(_ sql: String) -> Bool {
    sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
  }

  /// One transaction and one prepared statement for the whole batch.
  func insert(_ bodies: [String]) {
    guard !bodies.isEmpty else { return }
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "INSERT INTO events (body) VALUES (?);", -1, &stmt, nil) == SQLITE_OK else { return }
    defer { sqlite3_finalize(stmt) }
    exec("BEGIN;")
    for body in bodies {
      sqlite3_bind_text(stmt, 1, body, -1, SQLITE_TRANSIENT)
      sqlite3_step(stmt)
      sqlite3_reset(stmt)
    }
    exec("COMMIT;")
  }

  func count() -> Int {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM events;", -1, &stmt, nil) == SQLITE_OK else { return 0 }
    defer { sqlite3_finalize(stmt) }
    return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int64(stmt, 0)) : 0
  }

  /// Oldest events first.
  func peek(limit: Int) -> [(seq: Int64, body: String)] {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT seq, body FROM events ORDER BY seq LIMIT ?;", -1, &stmt, nil) == SQLITE_OK else { return [] }
    defer { sqlite3_finalize(stmt) }
    sqlite3_bind_int64(stmt, 1, Int64(limit))
    var rows: [(Int64, String)] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      let seq = sqlite3_column_int64(stmt, 0)
      if let text = sqlite3_column_text(stmt, 1) {
        rows.append((seq, String(cString: text)))
      }
    }
    return rows
  }

  func delete(upTo seq: Int64) {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, "DELETE FROM events WHERE seq <= ?;", -1, &stmt, nil) == SQLITE_OK else { return }
    sqlite3_bind_int64(stmt, 1, seq)
    sqlite3_step(stmt)
    sqlite3_finalize(stmt)
  }

  func clear() {
    exec("DELETE FROM events;")
  }

  /// Keeps only the newest `max` events.
  func trim(to max: Int) {
    var stmt: OpaquePointer?
    // Uses the primary key index, no full scan.
    let sql = "DELETE FROM events WHERE seq < (SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?);"
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
    sqlite3_bind_int64(stmt, 1, Int64(max - 1))
    sqlite3_step(stmt)
    sqlite3_finalize(stmt)
  }
}
