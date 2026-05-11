import ExpoModulesCore
import Foundation
import LiteRTLM

/**
 * NivocaAi — on-device Gemma 4 E2B vision-language inference for iOS.
 *
 * Wraps the LiteRT-LM C engine (vendored as `LiteRTLM.xcframework`, sourced
 * from the hung-yueh/react-native-litert-lm v0.3.6 release build, which in
 * turn embeds Google's prebuilt LiteRT-LM static library + Metal accelerator
 * dylibs). All download / status work lives in TypeScript (`model-manager.ts`);
 * this Swift module owns the synchronous loaded-model lifecycle and a single
 * blocking `infer(prompt, imagePath)` call.
 *
 * Memory shape: engine + session are created lazily on the first `infer` call
 * and held for the lifetime of the JS context. Closing the app or hitting
 * memory pressure tears down the entire process anyway, so we don't bother
 * with a manual `close()` from JS — Phase F will revisit if iOS Jetsam kills
 * us mid-session.
 */
public class NivocaAiModule: Module {
  /// Resolves to the on-disk model path the TS `model-manager` wrote to.
  /// Keep in sync with `apps/mobile/src/lib/ai/model-manager.ts`'s MODEL_PATH.
  private static let modelFilename = "gemma-4-E2B-it.litertlm"
  private static let modelSubdir = "ai-models"

  private var engineSettings: OpaquePointer? = nil
  private var engine: OpaquePointer? = nil
  private var session: OpaquePointer? = nil
  private let loadQueue = DispatchQueue(label: "win.jun-devlog.nivoca.ai.load")

  public func definition() -> ModuleDefinition {
    Name("NivocaAi")

    Events("onModelStatus")

    Function("ping") { () -> String in
      return "nivoca-ai:ios:phase-d"
    }

    // Phase C model-lifecycle stubs (TS owns the real work via model-manager).
    AsyncFunction("startDownload") { (_: String, _: String) -> Void in
      throw NivocaAiError("not_used", "Download is owned by JS model-manager")
    }
    AsyncFunction("cancelDownload") { () -> Void in
      throw NivocaAiError("not_used", "Cancel is owned by JS model-manager")
    }
    AsyncFunction("deleteModel") { () -> Void in
      throw NivocaAiError("not_used", "Delete is owned by JS model-manager")
    }
    AsyncFunction("getStatus") { () -> [String: Any] in
      return ["state": "not_installed"]
    }

    // ---- Phase D: real multimodal inference ----
    AsyncFunction("infer") { (prompt: String, imagePath: String) -> String in
      return try self.runInference(prompt: prompt, imagePath: imagePath)
    }
  }

  // MARK: - Lazy engine + session

  private func resolveModelPath() throws -> String {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    guard let docs else {
      throw NivocaAiError("no_docs_dir", "Documents directory unavailable")
    }
    let path = docs
      .appendingPathComponent(Self.modelSubdir)
      .appendingPathComponent(Self.modelFilename)
      .path
    guard FileManager.default.fileExists(atPath: path) else {
      throw NivocaAiError("model_missing", "Model file not found at \(path)")
    }
    return path
  }

  private func ensureLoaded() throws {
    // Concurrent `infer` calls would otherwise race the lazy init.
    // Forward-declared C structs cross into Swift as `OpaquePointer?`; no
    // `OpaquePointer(...)` conversion is needed (and would actually fail —
    // there is no `init(_: OpaquePointer)` initializer).
    try loadQueue.sync {
      if self.engine != nil && self.session != nil { return }
      let modelPath = try resolveModelPath()

      // backend="gpu" → Metal on iPhone. vision_backend="gpu" enables the
      // Gemma 4 vision tower on Metal. Audio backend unused.
      guard let settings = litert_lm_engine_settings_create(modelPath, "gpu", "gpu", nil) else {
        throw NivocaAiError("settings_create_failed", "Could not create engine settings")
      }
      self.engineSettings = settings

      guard let eng = litert_lm_engine_create(settings) else {
        litert_lm_engine_settings_delete(settings)
        self.engineSettings = nil
        throw NivocaAiError("engine_create_failed", "Could not create LiteRT-LM engine — check model file integrity and GPU availability")
      }
      self.engine = eng

      guard let sess = litert_lm_engine_create_session(eng, nil) else {
        litert_lm_engine_delete(eng)
        litert_lm_engine_settings_delete(settings)
        self.engine = nil
        self.engineSettings = nil
        throw NivocaAiError("session_create_failed", "Could not create LiteRT-LM session")
      }
      self.session = sess
    }
  }

  // MARK: - Inference

  private func runInference(prompt: String, imagePath: String) throws -> String {
    try ensureLoaded()
    guard let session = self.session else {
      throw NivocaAiError("not_ready", "Session not initialized")
    }

    // Load the JPEG bytes into memory. We trust the caller (TS `inference.ts`)
    // to have written a sane temp file under ~ 5 MB.
    let url = URL(fileURLWithPath: imagePath)
    guard let imageData = try? Data(contentsOf: url) else {
      throw NivocaAiError("image_read_failed", "Could not read image at \(imagePath)")
    }

    // `prompt.withCString` keeps the buffer alive for the closure body so the
    // `InputData` we hand to LiteRT-LM doesn't reference freed memory. Nested
    // inside `imageData.withUnsafeBytes` so both pointers stay live for the
    // duration of `litert_lm_session_generate_content`.
    return try imageData.withUnsafeBytes { (rawBuffer: UnsafeRawBufferPointer) -> String in
      guard let imagePtr = rawBuffer.baseAddress else {
        throw NivocaAiError("image_buffer_empty", "Empty image buffer")
      }
      return try prompt.withCString { (promptPtr: UnsafePointer<CChar>) -> String in
        let promptSize = strlen(promptPtr)

        // Multimodal layout for Gemma-style chat: image bytes + IMAGE_END
        // marker + text prompt. The C engine handles vision encoding
        // internally based on `vision_backend_str`.
        var inputs: [InputData] = [
          InputData(type: kInputImage, data: imagePtr, size: rawBuffer.count),
          InputData(type: kInputImageEnd, data: nil, size: 0),
          InputData(type: kInputText, data: UnsafeRawPointer(promptPtr), size: promptSize),
        ]

        // Forward-declared C structs (`LiteRtLmResponses` etc.) are imported
        // by Swift as `OpaquePointer?` — there is no named Swift type. The
        // engine returns the response handle as one such opaque pointer.
        let responses: OpaquePointer? = inputs.withUnsafeMutableBufferPointer { ptr in
          return litert_lm_session_generate_content(
            session,
            ptr.baseAddress,
            ptr.count
          )
        }

        guard let responses = responses else {
          throw NivocaAiError("generate_failed", "litert_lm_session_generate_content returned NULL")
        }
        defer { litert_lm_responses_delete(responses) }

        let numCandidates = litert_lm_responses_get_num_candidates(responses)
        guard numCandidates > 0,
              let textCString = litert_lm_responses_get_response_text_at(responses, 0) else {
          throw NivocaAiError("empty_response", "No candidates returned")
        }
        return String(cString: textCString)
      }
    }
  }
}

// MARK: - Error helper

private final class NivocaAiError: Error, CustomStringConvertible {
  let code: String
  let message: String
  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }
  var description: String { "\(code): \(message)" }
  var localizedDescription: String { description }
}
