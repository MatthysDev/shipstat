package expo.modules.shipstat

import android.app.job.JobParameters
import android.app.job.JobService

/**
 * Sends the events still waiting after the app went to the background, once a network is up,
 * even if Android stopped the app meanwhile. Android runs it with other apps' work.
 */
class ShipstatUploadJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    ShipstatCore.get(applicationContext).uploadInBackground { retry -> jobFinished(params, retry) }
    return true
  }

  /** Android stopped the job (network lost, time is up): keep it for later. */
  override fun onStopJob(params: JobParameters): Boolean = true
}
