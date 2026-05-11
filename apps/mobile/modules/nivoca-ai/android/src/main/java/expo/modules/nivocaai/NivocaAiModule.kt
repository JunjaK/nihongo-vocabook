package expo.modules.nivocaai

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub for NivocaAi. The on-device AI path is iOS-only — Android
 * users stay on the web (transformers.js) pipeline. This stub exists so the
 * autolinking compiles and `requireNativeModule('NivocaAi')` doesn't throw at
 * import time; any actual call surfaces a clear `IOS_ONLY` error.
 */
class NivocaAiModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NivocaAi")

    Events("onModelStatus")

    Function("ping") { "nivoca-ai:android:stub" }

    AsyncFunction("startDownload") { _: String, _: String ->
      throw CodedException("IOS_ONLY", "NivocaAi is iOS-only — startDownload is unsupported on Android", null)
    }
    AsyncFunction("cancelDownload") {
      throw CodedException("IOS_ONLY", "NivocaAi is iOS-only — cancelDownload is unsupported on Android", null)
    }
    AsyncFunction("deleteModel") {
      throw CodedException("IOS_ONLY", "NivocaAi is iOS-only — deleteModel is unsupported on Android", null)
    }
    AsyncFunction("getStatus") {
      mapOf("state" to "not_installed")
    }
    AsyncFunction("infer") { _: String, _: String ->
      throw CodedException("IOS_ONLY", "NivocaAi is iOS-only — infer is unsupported on Android", null)
    }
  }
}
