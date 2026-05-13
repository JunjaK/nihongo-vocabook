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
  /// Plaintext file the TS model-manager writes to record which variant is
  /// active. Contents are one of the `ModelVariantId` strings
  /// (e.g. `"gemma-4-e2b"`). Missing or unreadable → fall back to the first
  /// `.litertlm` file we find (legacy single-variant boot).
  private static let activeMetaFilename = "active.txt"
  /// Maps a `ModelVariantId` value to the `.litertlm` filename it owns.
  /// Must stay in sync with `MODEL_VARIANTS` in
  /// apps/mobile/src/lib/ai/model-manager.ts.
  private static let variantFilenames: [String: String] = [
    "gemma-4-e2b": "gemma-4-E2B-it.litertlm",
    "gemma-4-e4b": "gemma-4-E4B-it.litertlm",
  ]

  private var engine: OpaquePointer? = nil
  private var sessionConfig: OpaquePointer? = nil
  private var convConfig: OpaquePointer? = nil
  /// Path of the `.litertlm` file currently loaded into `engine`. Tracking
  /// this lets us notice when the user switches active variants in settings
  /// and rebuild the engine on next `ensureLoaded` instead of running the
  /// new request against the stale model.
  private var loadedModelPath: String? = nil
  // NOTE: conversation is intentionally NOT cached across infer() calls —
  // the LiteRT-LM conversation API accumulates chat history, so reusing it
  // across requests would re-feed the previous user prompt + assistant
  // response on every call, quickly overflowing max_num_tokens (we saw
  // raw.len drop from 2176 → 2 → 1 on successive calls when it was cached).
  // We recreate per-call to get a clean session each time; engine and
  // configs remain cached because they're the expensive setup work.
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

    // Multi-variant active lookup: TS writes the active variantId into
    // `ai-models/active.txt`. We resolve it to the matching `.litertlm`
    // filename and prefer that file. Falls back to "first .litertlm we
    // find on disk" if the meta file is missing or stale (e.g. user
    // upgraded from the single-variant build).
    let metaUrl = dir.appendingPathComponent(Self.activeMetaFilename)
    let activeVariantId: String? = (
      try? String(contentsOf: metaUrl, encoding: .utf8)
    )?.trimmingCharacters(in: .whitespacesAndNewlines)

    let contents = (try? FileManager.default.contentsOfDirectory(
      at: dir,
      includingPropertiesForKeys: [.fileSizeKey],
      options: [.skipsHiddenFiles]
    )) ?? []
    let candidates = contents.filter { $0.pathExtension == Self.modelExtension }

    var modelUrl: URL?
    if let activeId = activeVariantId,
       let expectedFilename = Self.variantFilenames[activeId] {
      modelUrl = candidates.first { $0.lastPathComponent == expectedFilename }
      if modelUrl == nil {
        logger.error("resolveModelPath: active=\(activeId, privacy: .public) but file \(expectedFilename, privacy: .public) missing — falling back to first .litertlm")
      }
    }
    if modelUrl == nil {
      modelUrl = candidates.first
    }

    guard let modelUrl else {
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
    // Expected sizes: E2B ≈ 2,588,147,712 bytes (2.41 GB), E4B ≈
    // 3,659,530,240 bytes (3.41 GB). Dramatic shortfall ⇒ truncated download.
    logger.error("resolveModelPath: active=\(activeVariantId ?? "nil", privacy: .public) filename=\(modelUrl.lastPathComponent, privacy: .public) size=\(fileSize)")
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
    // KV cache size = prefill (image ~256 + prompt ~400 + template) + decode (≤1024).
    // 1024 overflows when the model + image fills ~700 tokens before generation starts,
    // which manifested as a DYNAMIC_UPDATE_SLICE prepare-time failure at decode node 1164.
    litert_lm_engine_settings_set_max_num_tokens(settings, 2048)
    litert_lm_engine_settings_set_cache_dir(settings, cacheDir)
    // Gemma 4's .litertlm bundle ships an MTP drafter section; v0.11.0 enables
    // speculative decoding by default when it sees one. The drafter writes K
    // tokens per step into a single cache slot, which mismatches the main
    // decoder's K=1 slice shape and trips the same DYNAMIC_UPDATE_SLICE check.
    // Disabling MTP costs throughput but avoids the shape conflict entirely.
    litert_lm_engine_settings_set_enable_speculative_decoding(settings, false)

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
      // The default sampler is greedy (argmax), which makes the model fall
      // into hard repetition loops on JSON list outputs — it kept emitting
      // the same 5 entries over and over until max_output_tokens cut it
      // off. Switch to top-p sampling with a moderate temperature so
      // continuation probabilities have some spread.
      var sampler = LiteRtLmSamplerParams(
        type: kLiteRtLmSamplerTypeTopP,
        top_k: 40,
        top_p: 0.95,
        temperature: 0.7,
        seed: 0
      )
      withUnsafePointer(to: &sampler) { ptr in
        litert_lm_session_config_set_sampler_params(sc, ptr)
      }
    }
    self.sessionConfig = sc

    // Conversation config: no system prompt, no tools, no message history,
    // no constrained decoding — we want the model to free-form respond to
    // each request.
    //
    // v0.11.0 split the 6-arg conversation_config_create into a zero-arg
    // constructor + individual setters. The old call was:
    //   litert_lm_conversation_config_create(eng, sc, nil, nil, nil, false)
    // We only need to wire the session config (sampler / max_output_tokens
    // holder) and explicitly disable constrained decoding — everything
    // else stays at its default (NULL / false).
    guard let cc = litert_lm_conversation_config_create() else {
      logger.error("tryCreateEngine: conversation_config_create returned NULL for backend=\(backend, privacy: .public)")
      if sc != nil { litert_lm_session_config_delete(sc) }
      litert_lm_engine_delete(eng)
      self.engine = nil
      self.sessionConfig = nil
      return false
    }
    if sc != nil {
      litert_lm_conversation_config_set_session_config(cc, sc)
    }
    litert_lm_conversation_config_set_enable_constrained_decoding(cc, false)
    self.convConfig = cc

    // Smoke test: create + immediately delete a conversation to verify the
    // engine actually accepts conversation_create with this config. If this
    // fails we cycle to the next backend; if it succeeds we discard the
    // conversation so runInference starts each call with a fresh one.
    guard let smokeConv = litert_lm_conversation_create(eng, cc) else {
      logger.error("tryCreateEngine: conversation_create smoke-test returned NULL for backend=\(backend, privacy: .public)")
      litert_lm_conversation_config_delete(cc)
      if sc != nil { litert_lm_session_config_delete(sc) }
      litert_lm_engine_delete(eng)
      self.engine = nil
      self.sessionConfig = nil
      self.convConfig = nil
      return false
    }
    litert_lm_conversation_delete(smokeConv)
    return true
  }

  /// Free the cached engine + configs. Called when the user switches the
  /// active variant in settings so the next `infer` reloads from the new
  /// `.litertlm` instead of running against the previous model.
  private func teardownEngine() {
    if let cc = self.convConfig {
      litert_lm_conversation_config_delete(cc)
    }
    if let sc = self.sessionConfig {
      litert_lm_session_config_delete(sc)
    }
    if let eng = self.engine {
      litert_lm_engine_delete(eng)
    }
    self.engine = nil
    self.sessionConfig = nil
    self.convConfig = nil
    self.loadedModelPath = nil
  }

  private func ensureLoaded() throws {
    // Concurrent `infer` calls would otherwise race the lazy init.
    try loadQueue.sync {
      let modelPath = try resolveModelPath()
      if self.engine != nil && self.convConfig != nil {
        if self.loadedModelPath == modelPath {
          logger.info("ensureLoaded: reusing cached engine + config")
          return
        }
        logger.info("ensureLoaded: active variant changed (\(self.loadedModelPath ?? "nil", privacy: .public) → \(modelPath, privacy: .public)), tearing down cached engine")
        self.teardownEngine()
      }
      logger.info("ensureLoaded: cold start, modelPath=\(modelPath, privacy: .public)")
      // Cache dir = directory containing the model file. The LiteRT-LM
      // engine writes compiled Metal shader caches there on first run.
      let cacheDir = (modelPath as NSString).deletingLastPathComponent
      logger.info("ensureLoaded: cacheDir=\(cacheDir, privacy: .public)")

      // ---- Diagnostic: capture LiteRT-LM stderr to surface the real
      //      engine_create failure. iOS does not route stderr to os_log,
      //      so we dup2 stderr to a file under cacheDir, crank log level
      //      to INFO, run the attempts, then drain the file back through
      //      os_log on scope exit. Remove once root cause is identified.
      let stderrLogPath = (cacheDir as NSString).appendingPathComponent("litertlm-stderr.log")
      try? FileManager.default.removeItem(atPath: stderrLogPath)
      let savedStderr = dup(STDERR_FILENO)
      let captureFD = stderrLogPath.withCString { p in
        open(p, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
      }
      var capturing = false
      if captureFD >= 0 {
        dup2(captureFD, STDERR_FILENO)
        close(captureFD)
        setbuf(stderr, nil)
        capturing = true
        logger.error("stderrCapture: ON → \(stderrLogPath, privacy: .public)")
      } else {
        logger.error("stderrCapture: open() failed errno=\(errno)")
      }
      defer {
        if capturing {
          fflush(stderr)
          dup2(savedStderr, STDERR_FILENO)
          close(savedStderr)
          if let content = try? String(contentsOfFile: stderrLogPath, encoding: .utf8) {
            let lines = content.split(separator: "\n", omittingEmptySubsequences: true)
            logger.error("stderrCapture: drained \(lines.count) line(s) from LiteRT-LM")
            for line in lines.prefix(300) {
              logger.error("LRTLM: \(String(line), privacy: .public)")
            }
          } else {
            logger.error("stderrCapture: could not read drain file")
          }
          try? FileManager.default.removeItem(atPath: stderrLogPath)
        } else {
          close(savedStderr)
        }
      }

      // Maximally verbose during diagnostic capture.
      // v0.11.0 levels: 0=VERBOSE, 1=DEBUG, 2=INFO, 3=WARNING, 4=ERROR, 5=FATAL, 1000=SILENT.
      litert_lm_set_min_log_level(0)

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
          self.loadedModelPath = modelPath
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
    guard let engine = self.engine, let convConfig = self.convConfig else {
      throw NivocaAiError("not_ready", "Engine not initialized")
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

    // Fresh conversation per call — the conversation API accumulates chat
    // history across send_message calls, and reusing it bloats the KV cache
    // until the model EOS's immediately (we saw raw.len collapse from
    // 2176 → 2 → 1 across consecutive calls with a shared conversation).
    guard let conversation = litert_lm_conversation_create(engine, convConfig) else {
      logger.error("runInference: conversation_create returned NULL")
      throw NivocaAiError("not_ready", "Could not create conversation for this request")
    }
    defer { litert_lm_conversation_delete(conversation) }

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
