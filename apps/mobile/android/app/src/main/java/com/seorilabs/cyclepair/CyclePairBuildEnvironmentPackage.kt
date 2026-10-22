package com.seorilabs.cyclepair

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager

class CyclePairBuildEnvironmentPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(object : ReactContextBaseJavaModule(context) {
      override fun getName() = "CyclePairBuildEnvironment"
      override fun getConstants(): Map<String, Any> =
        mapOf("syntheticQa" to BuildConfig.IS_SYNTHETIC_QA)
    })

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
