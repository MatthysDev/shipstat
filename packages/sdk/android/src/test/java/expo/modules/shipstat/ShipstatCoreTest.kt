package expo.modules.shipstat

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.Context
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The native core against a real local HTTP server. Same scenarios as test/ios/main.swift. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ShipstatCoreTest {
  private val context: Context = RuntimeEnvironment.getApplication()
  private val server = TestServer()

  /** One app install: its preferences and database survive [open] calls, like a relaunch. */
  private inner class Install {
    private val name = "t-${UUID.randomUUID()}"
    fun open() = ShipstatCore(context, name, "$name.db")
  }

  @After
  fun stop() = server.close()

  private fun config(flushAt: Int = 50, intervalMs: Long = 60_000, maxQueue: Int = 10_000, compress: Boolean = true) =
    ShipstatConfig(server.url, mapOf("Authorization" to "Bearer test"), flushAt, intervalMs, maxQueue, false, compress)

  private fun ShipstatCore.start(cfg: ShipstatConfig = config()) = also { it.configure(cfg, true, emptyMap()) }

  private fun ShipstatCore.event(name: String, i: Int = 0) = track(name, "{\"i\":$i}", System.currentTimeMillis().toDouble())

  /** Sends now and waits for the attempt (and any resend it triggers) to be over. */
  private fun ShipstatCore.flushNow() {
    val done = CountDownLatch(1)
    flush { done.countDown() }
    assertTrue("flush finished", done.await(10, TimeUnit.SECONDS))
  }

  /** Waits for buffered track() calls to reach the disk: they are written one executor turn later. */
  private fun ShipstatCore.settled(): Int {
    waitingCount()
    return waitingCount()
  }

  /** Goes to the background and waits for the send it tries. */
  private fun ShipstatCore.background() {
    val done = CountDownLatch(1)
    onBackground { done.countDown() }
    assertTrue("background send finished", done.await(10, TimeUnit.SECONDS))
  }

  private fun ctx(e: JSONObject) = e.getJSONObject("context")

  @Test
  fun sendsAFullBatchOnItsOwnGzippedInTheDocumentedFormat() {
    val core = Install().open()
    core.configure(config(flushAt = 3), true, mapOf("ota" to "update-1"))
    repeat(3) { core.event("opened", it) }
    assertTrue("a request arrives without flush()", server.waitFor(1))
    val req = server.requests.first()
    assertTrue("gzipped", req.gzipped)
    assertEquals("Bearer test", req.headers["authorization"])
    assertEquals("application/json", req.headers["content-type"])
    assertEquals(1, req.json.getInt("schema"))
    assertTrue(req.json.has("sent_at"))
    val events = req.events
    assertEquals(3, events.size)
    assertEquals(3, events.map { it.getString("id") }.toSet().size)
    val e = events.first()
    assertEquals(36, e.getString("id").length)
    assertTrue(e.getString("ts"), Regex("""^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$""").matches(e.getString("ts")))
    assertTrue(e.getString("anon_id").isNotEmpty())
    assertTrue(e.isNull("user_id"))
    assertEquals(0, e.getJSONObject("props").getInt("i"))
    assertEquals("android", ctx(e).getString("platform"))
    assertEquals(ShipstatCore.SDK_VERSION, ctx(e).getString("sdk_version"))
    assertEquals("update-1", ctx(e).getString("ota"))
    assertTrue(ctx(e).has("app_version") && ctx(e).has("os_version") && ctx(e).has("device_model"))
    assertEquals(0, core.waitingCount())
  }

  @Test
  fun keepsEventsTrackedBeforeInit() {
    val core = Install().open()
    core.event("early", 1)
    core.event("early", 2)
    core.start().flushNow()
    assertEquals(listOf("early", "early"), names(server.delivered))
  }

  @Test
  fun sendsAfterTheIntervalThenNeverWakesUpWhileIdle() {
    val core = Install().open().start(config(intervalMs = 300))
    core.event("one")
    assertTrue("sent once the interval passed", server.waitFor(1, 3_000))
    Thread.sleep(1_500)
    assertEquals("no request while nothing waits", 1, server.requests.size)
  }

  @Test
  fun resendsAsPlainJsonOnceWhenGzipIsRefusedAndStaysPlain() {
    val core = Install().open().start()
    server.reply(415)
    core.event("a")
    core.event("b")
    core.flushNow()
    core.event("c")
    core.flushNow()
    assertEquals(listOf(true, false, false), server.requests.map { it.gzipped })
    assertEquals(listOf("a", "b", "c"), names(server.delivered))
  }

  @Test
  fun keepsCompressingWhenPlainJsonFailsToo() {
    val core = Install().open().start()
    server.reply(400, 400)
    core.event("bad")
    core.flushNow()
    assertEquals("a batch the server rejects is dropped", 0, core.waitingCount())
    core.event("next")
    core.flushNow()
    assertEquals(listOf(true, false, true), server.requests.map { it.gzipped })
  }

  @Test
  fun keepsEventsWhileTheServerFailsAndSendsThemOnTheNextTry() {
    val core = Install().open().start()
    server.reply(503)
    core.event("a")
    core.event("b")
    core.flushNow()
    assertEquals(2, core.waitingCount())
    core.flushNow()
    assertEquals(listOf("a", "b"), names(server.delivered))
    assertEquals(0, core.waitingCount())
  }

  @Test
  fun keepsEventsThroughADroppedConnection() {
    val core = Install().open().start()
    server.reply(0)
    core.event("a")
    core.flushNow()
    assertEquals("kept after a network error", 1, core.waitingCount())
    core.flushNow()
    assertEquals(listOf("a"), names(server.delivered))
  }

  @Test
  fun optOutDeletesWaitingEventsSendsNothingAndSurvivesARelaunch() {
    val install = Install()
    val core = install.open().start()
    core.event("a")
    core.settled()
    core.setEnabled(false)
    core.event("b")
    core.flushNow()
    assertEquals(0, core.waitingCount())
    val again = install.open().start()
    again.event("c")
    again.flushNow()
    assertTrue("nothing sent", server.requests.isEmpty())
    again.setEnabled(true)
    again.event("d")
    again.flushNow()
    assertEquals("opting back in sends only new events", listOf("d"), names(server.delivered))
  }

  @Test
  fun capsTheQueueAndKeepsTheNewestEvents() {
    val core = Install().open().start(config(flushAt = 1000, maxQueue = 100))
    repeat(250) { core.event("e", it) }
    val waiting = core.settled()
    assertTrue("about 100 waiting, got $waiting", waiting in 100..110)
    core.flushNow()
    val ids = server.delivered.map { it.getJSONObject("props").getInt("i") }
    assertEquals(249, ids.last())
    assertTrue("oldest dropped, first is ${ids.first()}", ids.first() >= 140)
  }

  @Test
  fun contextUserIdAndAnonymousIdPersistAcrossARelaunch() {
    val install = Install()
    val core = install.open().start()
    core.setContext(mapOf("variant" to "b", "nested" to mapOf("x" to 1), "bad" to Double.NaN))
    core.identify("u1")
    core.event("a")
    core.unsetContext(listOf("variant"))
    core.event("b")
    core.setContext(mapOf("feature" to "paywall"))
    core.flushNow()
    val d = server.delivered
    assertEquals(2, d.size)
    assertEquals("b", ctx(d[0]).getString("variant"))
    assertFalse("nested and NaN values dropped", ctx(d[0]).has("nested") || ctx(d[0]).has("bad"))
    assertEquals("u1", d[0].getString("user_id"))
    assertFalse("unset tag gone", ctx(d[1]).has("variant"))
    val anon = core.anonymousId()
    val again = install.open()
    assertEquals("same anonymous id after relaunch", anon, again.anonymousId())
    again.start().event("c")
    again.flushNow()
    val c = server.delivered.last()
    assertEquals("u1", c.getString("user_id"))
    assertEquals("paywall", ctx(c).getString("feature"))
  }

  @Test
  fun eventsTrackedBeforeACrashAreSentOnTheNextLaunch() {
    val install = Install()
    val first = install.open()
    repeat(3) { first.event("before", it) }
    first.settled()
    install.open().start().flushNow()
    assertEquals(3, server.delivered.size)
  }

  @Test
  fun resetGivesANewAnonymousIdAndForgetsTheUser() {
    val core = Install().open().start()
    core.identify("u1")
    val before = core.anonymousId()
    core.reset()
    assertNotEquals(before, core.anonymousId())
    core.event("a")
    core.flushNow()
    assertTrue(server.delivered.first().isNull("user_id"))
  }

  // Background upload (JobScheduler)

  private val scheduler get() = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
  private fun uploadJob(): JobInfo? = scheduler.allPendingJobs.firstOrNull { it.id == ShipstatCore.UPLOAD_JOB_ID }

  @Test
  fun leavesAnUploadJobWhenTheBackgroundSendFails() {
    val core = Install().open().start()
    server.reply(503)
    core.event("a")
    core.settled()
    core.background()
    val job = uploadJob()
    assertTrue("job scheduled", job != null)
    assertEquals(JobInfo.NETWORK_TYPE_ANY, job!!.networkType)
    assertEquals("not before the flush interval", 60_000L, job.minLatencyMillis)
    core.onForeground()
    core.settled()
    assertTrue("cancelled in the foreground", uploadJob() == null)
  }

  @Test
  fun leavesNoJobWhenTheBackgroundSendWorks() {
    val core = Install().open().start()
    core.event("a")
    core.settled()
    core.background()
    assertEquals(listOf("a"), names(server.delivered))
    assertTrue("no job left", uploadJob() == null)
  }

  @Test
  fun leavesNoJobWhenNothingWaitsOrTrackingIsOff() {
    val core = Install().open().start()
    core.background()
    assertTrue(uploadJob() == null)
    core.setEnabled(false)
    core.event("a")
    core.background()
    assertTrue(uploadJob() == null)
    assertTrue(server.requests.isEmpty())
  }

  @Test
  fun theUploadJobSendsFromAFreshProcessWithTheSavedConfig() {
    val install = Install()
    val app = install.open().start()
    server.reply(503)
    app.event("a")
    app.event("b")
    app.flushNow()
    assertEquals(2, app.waitingCount())

    // Android started a new process for the job: no init, no JavaScript.
    fun runJob(): Boolean {
      val done = CountDownLatch(1)
      var retry = false
      install.open().uploadInBackground { retry = it; done.countDown() }
      assertTrue(done.await(10, TimeUnit.SECONDS))
      return retry
    }
    server.reply(503)
    assertTrue("asks for a retry while the server fails", runJob())
    assertFalse("done once sent", runJob())
    assertEquals(listOf("a", "b"), names(server.delivered))
    assertEquals("Bearer test", server.requests.last().headers["authorization"])
    assertTrue("still gzipped", server.requests.last().gzipped)
  }
}
