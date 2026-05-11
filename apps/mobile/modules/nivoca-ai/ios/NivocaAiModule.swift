import ExpoModulesCore
import Foundation
import LiteRTLM
import OSLog

private let logger = Logger(subsystem: "win.jun-devlog.nivoca", category: "nivoca-ai")

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
 * Memory shape: engine + conversation are created lazily on the first
 * `infer` call and held for the lifetime of the JS context. Closing the
 * app or hitting memory pressure tears down the entire process anyway, so
 * we don't bother with a manual `close()` from JS — Phase F will revisit
 * if iOS Jetsam kills us mid-session.
 *
 * Multimodal path: we use the **conversation API**, not raw
 * `session_generate_content`. The latter wants InputData[] with the image
 * as a byte pointer; the iOS XCFramework's vision executor rejects that
 * almost immediately. The conversation API takes a JSON message with the
 * image as a *file path* and handles decoding + preprocessing internally —
 * this is the only multimodal path Google's iOS build supports.
 */
public class NivocaAiModule: Module {
  /// Directory under `Documents/` that `model-manager.ts` writes to. The
  /// filename is variant-dependent (gemma-4-E2B-it / gemma-4-E4B-it), so
  /// we scan for any `.litertlm` file rather than hard-code one name —
  /// single-variant-at-a-time policy is enforced on the TS side.
  private static let modelSubdir = "ai-models"
  private static let modelExtension = "litertlm"

  private var engine: OpaquePointer? = nil
  private var sessionConfig: OpaquePointer? = nil
  private var convConfig: OpaquePointer? = nil
  private var conversation: OpaquePointer? = nil
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
    let dir = docs.appendingPathComponent(Self.modelSubdir)
    // Find the first `.litertlm` file in the model directory. The TS
    // model-manager guarantees only one variant is present at a time, so
    // any match is the intended model.
    let contents = (try? FileManager.default.contentsOfDirectory(
      at: dir,
      includingPropertiesForKeys: [.fileSizeKey],
      options: [.skipsHiddenFiles]
    )) ?? []
    let candidates = contents.filter { $0.pathExtension == Self.modelExtension }
    guard let modelUrl = candidates.first else {
      logger.error("resolveModelPath: no .litertlm file under \(dir.path, privacy: .public) — \(contents.count) entries total")
      throw NivocaAiError(
        "model_missing",
        "No model file found in \(dir.path) — open Settings → OCR and download a Gemma variant"
      )
    }
    let path = modelUrl.path
    var fileSize: Int64 = -1
    if let attrs = try? FileManager.default.attributesOfItem(atPath: path),
       let n = attrs[.size] as? NSNumber {
      fileSize = n.int64Value
    }
    // Bump to .error level so it shows in the user's `오류 only` log view.
    // Expected sizes: E2B ≈ 2,588,147,712 bytes (2.41 GB). E4B ≈
    // 3,659,530,240 bytes (3.41 GB). Anything dramatically smaller is a
    // truncated download.
    logger.error("resolveModelPath: filename=\(modelUrl.lastPathComponent, privacy: .public) size=\(fileSize)")
    return path
  }

  /**
   * Try to build a LiteRT-LM engine + session_config + conversation with a
   * specific backend combination. Returns true on success (state stashed on
   * `self`), false on any failure — the caller iterates a fallback chain.
   *
   * Three settings tweaks discovered from hung-yueh/react-native-litert-lm's
   * own iOS bridge that are NOT obvious from the C header docs:
   *
   *  1. **audio_backend must be `"cpu"`, never NULL** — the iOS XCFramework
   *     was built without compiled audio operators, and passing NULL trips
   *     INTERNAL ERROR at Invoke. (Their comment, verbatim.)
   *  2. **`set_cache_dir` must be called** before `engine_create`. The
   *     engine writes compiled shader / kernel caches alongside the model;
   *     without a writable directory the GPU backend fails to initialize.
   *  3. **`set_max_num_tokens`** caps the KV-cache allocation. 1024 keeps
   *     us well under iOS Jetsam pressure while still being enough for
   *     vocab extraction (~50 words, 3-5 tokens each).
   *
   * Vision inference uses the **conversation API**, not raw
   * `session_generate_content` — the latter expects InputData with image
   * bytes inline, which the iOS XCFramework rejects in ~169μs ("not
   * implemented" path). The conversation API takes a JSON message with the
   * image as a file path and lets the engine handle decoding + preprocessing
   * internally.
   */
  private func tryCreateEngine(
    modelPath: String,
    backend: String,
    visionBackend: String?,
    cacheDir: String
  ) -> Bool {
    logger.info("tryCreateEngine: backend=\(backend, privacy: .public) vision=\(visionBackend ?? "nil") audio=cpu")
    guard let settings = litert_lm_engine_settings_create(
      modelPath, backend, visionBackend, "cpu"
    ) else {
      logger.error("tryCreateEngine: settings_create returned NULL for backend=\(backend, privacy: .public)")
      return false
    }
    litert_lm_engine_settings_set_max_num_tokens(settings, 1024)
    litert_lm_engine_settings_set_cache_dir(settings, cacheDir)

    let engineStart = Date()
    let eng = litert_lm_engine_create(settings)
    let elapsed = Date().timeIntervalSince(engineStart)
    litert_lm_engine_settings_delete(settings)
    if eng == nil {
      logger.error("tryCreateEngine: engine_create returned NULL for backend=\(backend, privacy: .public) after \(elapsed)s")
      return false
    }
    logger.info("tryCreateEngine: engine_create succeeded in \(elapsed)s for backend=\(backend, privacy: .public)")
    self.engine = eng

    // Session config: caps decode output. Reused as the conversation's
    // sampler params holder.
    let sc = litert_lm_session_config_create()
    if sc != nil {
      litert_lm_session_config_set_max_output_tokens(sc, 1024)
    }
    self.sessionConfig = sc

    // Conversation config: no system prompt, no tools, no message history,
    // no constrained decoding — we want the model to free-form respond to
    // each request.
    guard let cc = litert_lm_conversation_config_create(
      eng, sc, nil, nil, nil, false
    ) else {
      logger.error("tryCreateEngine: conversation_config_create returned NULL for backend=\(backend, privacy: .public)")
      if sc != nil { litert_lm_session_config_delete(sc) }
      litert_lm_engine_delete(eng)
      self.engine = nil
      self.sessionConfig = nil
      return false
    }
    self.convConfig = cc

    guard let conv = litert_lm_conversation_create(eng, cc) else {
      logger.error("tryCreateEngine: conversation_create returned NULL for backend=\(backend, privacy: .public)")
      litert_lm_conversation_config_delete(cc)
      if sc != nil { litert_lm_session_config_delete(sc) }
      litert_lm_engine_delete(eng)
      self.engine = nil
      self.sessionConfig = nil
      self.convConfig = nil
      return false
    }
    self.conversation = conv
    return true
  }

  private func ensureLoaded() throws {
    // Concurrent `infer` calls would otherwise race the lazy init.
    try loadQueue.sync {
      if self.engine != nil && self.conversation != nil {
        logger.info("ensureLoaded: reusing cached engine + conversation")
        return
      }
      logger.info("ensureLoaded: cold start, resolving model path")
      let modelPath = try resolveModelPath()
      // Cache dir = directory containing the model file. The LiteRT-LM
      // engine writes compiled Metal shader caches there on first run.
      let cacheDir = (modelPath as NSString).deletingLastPathComponent
      logger.info("ensureLoaded: cacheDir=\(cacheDir, privacy: .public)")

      // Quieten the engine's stderr to WARNING+. 0=INFO/debug; 2=WARNING.
      litert_lm_set_min_log_level(2)

      // Fallback chain, mirroring hung-yueh's iOS bridge — the same model
      // file can succeed on `cpu/gpu` but fail on `gpu/gpu` if the Metal
      // shader compile step OOMs, and even `cpu/cpu` is preferable to a
      // hard failure. Order from most-preferred (fastest) to most-reliable.
      let attempts: [(String, String?)] = [
        ("gpu", "gpu"),   // primary: full Metal acceleration
        ("cpu", "gpu"),   // vision encoder on GPU, decoder on CPU
        ("cpu", "cpu"),   // pure CPU
      ]
      for (backend, vision) in attempts {
        if tryCreateEngine(modelPath: modelPath, backend: backend, visionBackend: vision, cacheDir: cacheDir) {
          logger.info("ensureLoaded: succeeded with backend=\(backend, privacy: .public) vision=\(vision ?? "nil")")
          return
        }
      }
      logger.error("ensureLoaded: all backend combinations failed for modelPath=\(modelPath, privacy: .public)")
      throw NivocaAiError(
        "engine_create_failed",
        "Could not initialize LiteRT-LM engine on any backend (gpu/gpu, cpu/gpu, cpu/cpu). Likely a corrupted model file — try deleting + redownloading from Settings → OCR."
      )
    }
  }

  // MARK: - Inference

  /**
   * Build the multimodal message JSON the LiteRT-LM C API expects:
   *
   *     { "role": "user",
   *       "content": [
   *         { "type": "text",  "text": "<prompt>" },
   *         { "type": "image", "path": "<absolute path>" }
   *       ] }
   *
   * `JSONSerialization` handles escaping (quotes, backslashes, control
   * characters) — hand-rolling it bit us before.
   */
  private func buildImageMessageJson(prompt: String, imagePath: String) throws -> String {
    let payload: [String: Any] = [
      "role": "user",
      "content": [
        ["type": "text", "text": prompt],
        ["type": "image", "path": imagePath],
      ],
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [])
    guard let s = String(data: data, encoding: .utf8) else {
      throw NivocaAiError("json_encode_failed", "Could not UTF-8 encode message JSON")
    }
    return s
  }

  /**
   * Pull the assistant's text out of the raw JSON the C API returns. The
   * shape is one of:
   *
   *     { "role": "model", "content": [ { "type": "text", "text": "..." } ] }
   *     { "role": "model", "content": "..." }
   *
   * We also strip the Gemma chat-template control tokens that the iOS
   * XCFramework leaves in the output (the Kotlin SDK strips them on Android;
   * the C API does not).
   */
  private func extractTextFromResponse(_ json: String) -> String {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return json  // fall back to raw — caller will surface garbled output
    }
    var text: String = ""
    if let arr = obj["content"] as? [[String: Any]] {
      for entry in arr {
        if entry["type"] as? String == "text", let t = entry["text"] as? String {
          text += t
        }
      }
    } else if let s = obj["content"] as? String {
      text = s
    }
    // Strip Gemma control tokens.
    let controlTokens = [
      "<end_of_turn>",
      "<start_of_turn>model",
      "<start_of_turn>user",
      "<start_of_turn>",
      "<eos>",
    ]
    for tok in controlTokens {
      text = text.replacingOccurrences(of: tok, with: "")
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func runInference(prompt: String, imagePath: String) throws -> String {
    logger.info("runInference: prompt.len=\(prompt.count) imagePath=\(imagePath, privacy: .public)")
    try ensureLoaded()
    guard let conversation = self.conversation else {
      throw NivocaAiError("not_ready", "Conversation not initialized")
    }

    // C API does its own file IO for `{"type":"image","path":"..."}`; we
    // only verify existence early so we throw a clean Swift error instead
    // of bouncing through C and losing context.
    guard FileManager.default.fileExists(atPath: imagePath) else {
      logger.error("runInference: image_read_failed (not found) at \(imagePath, privacy: .public)")
      throw NivocaAiError("image_read_failed", "Image file not found at \(imagePath)")
    }

    let msgJson = try buildImageMessageJson(prompt: prompt, imagePath: imagePath)
    logger.info("runInference: msgJson.len=\(msgJson.count)")

    logger.info("runInference: calling litert_lm_conversation_send_message (blocking)")
    let inferStart = Date()
    let response = msgJson.withCString { cstr in
      litert_lm_conversation_send_message(conversation, cstr, nil)
    }
    let elapsed = Date().timeIntervalSince(inferStart)

    guard let response = response else {
      logger.error("runInference: conversation_send_message returned NULL after \(elapsed)s")
      throw NivocaAiError("generate_failed", "litert_lm_conversation_send_message returned NULL — engine could not process the request")
    }
    defer { litert_lm_json_response_delete(response) }
    logger.info("runInference: conversation_send_message done in \(elapsed)s")

    guard let cstr = litert_lm_json_response_get_string(response) else {
      throw NivocaAiError("empty_response", "Response had no JSON payload")
    }
    let rawJson = String(cString: cstr)
    logger.info("runInference: rawJson.len=\(rawJson.count)")
    let text = extractTextFromResponse(rawJson)
    logger.info("runInference: extracted text.len=\(text.count)")
    return text
  }
}

// MARK: - Error helper

/**
 * Custom error type bridged to JS through Expo Modules. Conforms to
 * `LocalizedError` (not just `Error` + `CustomStringConvertible`) so the
 * Cocoa runtime exposes `errorDescription` as the message; without it
 * the bridge falls back to the synthesized `(NivocaAi.(unknown context at
 * $X).NivocaAiError error N.)` placeholder that hides the actual code +
 * message we threw.
 */
private final class NivocaAiError: NSObject, LocalizedError {
  let code: String
  let message: String
  init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
    super.init()
  }
  override var description: String { "\(code): \(message)" }
  var errorDescription: String? { description }
  var failureReason: String? { message }
}
