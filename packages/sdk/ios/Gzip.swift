import Compression
import Foundation

/// Gzip (RFC 1952) built on Apple's Compression framework, which only emits raw DEFLATE:
/// we add the 10-byte header and the CRC32 + size trailer ourselves.
enum Gzip {
  static func compress(_ input: Data) -> Data? {
    guard !input.isEmpty else { return nil }
    let capacity = input.count + 1024
    var deflated = Data(count: capacity)
    let size = deflated.withUnsafeMutableBytes { dst in
      input.withUnsafeBytes { src in
        compression_encode_buffer(
          dst.bindMemory(to: UInt8.self).baseAddress!, capacity,
          src.bindMemory(to: UInt8.self).baseAddress!, input.count,
          nil, COMPRESSION_ZLIB)
      }
    }
    guard size > 0 else { return nil }
    var out = Data([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff])
    out.append(deflated.prefix(size))
    var crc = crc32(input).littleEndian
    var length = UInt32(truncatingIfNeeded: input.count).littleEndian
    withUnsafeBytes(of: &crc) { out.append(contentsOf: $0) }
    withUnsafeBytes(of: &length) { out.append(contentsOf: $0) }
    return out
  }

  private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
    var c = UInt32(i)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  private static func crc32(_ data: Data) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    data.withUnsafeBytes { buf in
      for b in buf.bindMemory(to: UInt8.self) { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
    }
    return c ^ 0xFFFF_FFFF
  }
}
