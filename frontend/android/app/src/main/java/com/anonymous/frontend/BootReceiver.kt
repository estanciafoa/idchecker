package com.anonymous.frontend

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Launches the app automatically after the device finishes booting, so an
 * Android box comes up straight into the ID checker without manual taps.
 * Requires the RECEIVE_BOOT_COMPLETED permission and a matching <receiver>
 * entry in AndroidManifest.xml.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action == Intent.ACTION_BOOT_COMPLETED ||
      action == "android.intent.action.QUICKBOOT_POWERON"
    ) {
      val launch = Intent(context, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(launch)
    }
  }
}
