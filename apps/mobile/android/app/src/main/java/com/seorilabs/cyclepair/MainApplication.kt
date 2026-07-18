package com.seorilabs.cyclepair

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createNeutralNotificationChannel()
    loadReactNative(this)
  }

  private fun createNeutralNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      getString(R.string.notification_channel_id),
      getString(R.string.notification_channel_name),
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = getString(R.string.notification_channel_description)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }
}
