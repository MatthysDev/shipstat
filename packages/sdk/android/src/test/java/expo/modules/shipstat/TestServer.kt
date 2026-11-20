package expo.modules.shipstat

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.zip.GZIPInputStream
import kotlin.concurrent.thread

/**
 * A real HTTP endpoint on 127.0.0.1: records every request it gets and answers from a script
 * (200 once the script is empty). A status of 0 closes the connection without answering.
 */
class TestServer : AutoCloseable {
  class Request(val headers: Map<String, String>, val raw: ByteArray, val status: Int) {
    val gzipped get() = headers["content-encoding"] == "gzip"
    val json: JSONObject
      get() = JSONObject(String(if (gzipped) GZIPInputStream(raw.inputStream()).readBytes() else raw, Charsets.UTF_8))
    val events: List<JSONObject>
      get() = json.getJSONArray("events").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
  }

  private val socket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
  private val received = ArrayList<Request>()
  private val script = ArrayDeque<Int>()
  val url get() = "http://127.0.0.1:${socket.localPort}/events"

  init {
    thread(isDaemon = true, name = "test-server") {
      while (!socket.isClosed) {
        val client = try { socket.accept() } catch (_: Exception) { break }
        thread(isDaemon = true) { client.use { handle(it) } }
      }
    }
  }

  private fun handle(client: Socket) {
    val input = client.getInputStream()
    val head = readHead(input) ?: return
    val lines = head.split("\r\n")
    val headers = lines.drop(1).mapNotNull { line ->
      val i = line.indexOf(':')
      if (i < 0) null else line.substring(0, i).trim().lowercase() to line.substring(i + 1).trim()
    }.toMap()
    val length = headers["content-length"]?.toIntOrNull() ?: 0
    val body = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(body, read, length - read)
      if (n < 0) return
      read += n
    }
    val status = synchronized(this) { (script.removeFirstOrNull() ?: 200).also { received.add(Request(headers, body, it)) } }
    if (status == 0) return
    client.getOutputStream().apply {
      write("HTTP/1.1 $status Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
      flush()
    }
  }

  private fun readHead(input: InputStream): String? {
    val out = ByteArrayOutputStream()
    var last4 = 0
    while (true) {
      val b = input.read()
      if (b < 0) return null
      out.write(b)
      last4 = (last4 shl 8) or b
      if (last4 == 0x0D0A0D0A) return String(out.toByteArray(), Charsets.ISO_8859_1)
    }
  }

  val requests: List<Request> get() = synchronized(this) { ArrayList(received) }

  /** Events the server accepted (2xx), in the order it got them. */
  val delivered: List<JSONObject> get() = requests.filter { it.status in 200..299 }.flatMap { it.events }

  fun reply(vararg statuses: Int) = synchronized(this) { script.addAll(statuses.toList()) }

  fun waitFor(requests: Int, timeoutMs: Long = 5_000): Boolean {
    val end = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < end) {
      if (this.requests.size >= requests) return true
      Thread.sleep(20)
    }
    return this.requests.size >= requests
  }

  override fun close() = socket.close()
}

fun names(events: List<JSONObject>) = events.map { it.getString("name") }
