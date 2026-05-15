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
// MARK: - Text inference request types (PoC + Phase 1)

/**
 * Wire format for the `inferText` AsyncFunction. Decoded from the JSON string
 * passed across the Expo bridge. Mirrors `AiTextInferRequest` in
 * apps/mobile/src/types/bridge.ts.
 *
 * PoC simplification: this struct accepts the full Phase 1 shape (multi-message,
 * tools, options), but the current runTextInference flattens it into a single
 * user-message payload for the conversation API. The richer multi-turn /
 * structured-tool template is deferred to Phase 1 once PoC measures whether
 * a prompt-only tool description is sufficient.
 */
private struct TextInferRequest: Decodable {
  struct Message: Decodable {
    let role: String
    let content: [ContentBlock]
  }
  struct ContentBlock: Decodable {
    let type: String           // "text" | "image" | "audio" | "tool_result"
    let text: String?
    /** File path (preferred) — when set, the native side feeds this path
     *  directly to the conversation API. */
    let path: String?
    /** Data URL or raw base64 (with or without mime prefix) — used for the
     *  web→native bridge path. Decoded to a temp file before inference. */
    let source: String?
    let mimeType: String?
    let toolName: String?
    let toolCallId: String?
    let result: NivocaJSONValue?
  }
  struct ToolDef: Decodable {
    let name: String
    let description: String
    let parameters: NivocaJSONValue?
  }
  struct Options: Decodable {
    let maxOutputTokens: Int?
    let temperature: Double?
  }
  let messages: [Message]
  let tools: [ToolDef]?
  let options: Options?
}

/**
 * Minimal JSON passthrough type that survives Decodable round-tripping
 * and converts back into Foundation-native types for `JSONSerialization`.
 *
 * Named `NivocaJSONValue` to avoid collisions with framework-level
 * `JSONValue` types that some pods declare.
 */
private indirect enum NivocaJSONValue: Decodable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  case array([NivocaJSONValue])
  case object([String: NivocaJSONValue])

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null; return }
    if let v = try? container.decode(Bool.self) { self = .bool(v); return }
    if let v = try? container.decode(Double.self) { self = .number(v); return }
    if let v = try? container.decode(String.self) { self = .string(v); return }
    if let v = try? container.decode([NivocaJSONValue].self) { self = .array(v); return }
    if let v = try? container.decode([String: NivocaJSONValue].self) { self = .object(v); return }
    throw DecodingError.dataCorruptedError(
      in: container, debugDescription: "Unsupported JSON shape")
  }

  fileprivate func toJSONObject() -> Any {
    switch self {
    case .null: return NSNull()
    case .bool(let b): return b
    case .number(let n): return n
    case .string(let s): return s
    case .array(let arr): return arr.map { $0.toJSONObject() }
    case .object(let dict):
      var result: [String: Any] = [:]
      for (k, v) in dict { result[k] = v.toJSONObject() }
      return result
    }
  }
}

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

  fileprivate var activeStreams: [String: StreamContext] = [:]
  fileprivate let streamsQueue = DispatchQueue(label: "win.jun-devlog.nivoca.ai.streams")

  public func definition() -> ModuleDefinition {
    Name("NivocaAi")

    Events("onModelStatus", "onInferStreamToken", "onInferStreamDone", "onInferStreamError")

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

    // ---- Phase 0 (PoC): blocking text-only inference for function-calling
    //      experiments. Phase 1 will add a streaming variant on top of this.
    AsyncFunction("inferText") { (requestJson: String) -> String in
      return try self.runTextInference(requestJson: requestJson)
    }

    // ---- Phase 1: streaming text inference. Emits onInferStreamToken events
    //      for each chunk, onInferStreamDone when the stream completes, and
    //      onInferStreamError on failure. Returns once the stream has been
    //      *started* — actual chunk delivery happens via events.
    AsyncFunction("inferTextStream") { (requestId: String, requestJson: String) -> Void in
      try self.startTextStream(requestId: requestId, requestJson: requestJson)
    }

    // ---- Phase 1: cancel an in-flight stream.
    AsyncFunction("cancelInferText") { (requestId: String) -> Void in
      self.cancelTextStream(requestId: requestId)
    }

    // ---- Phase 1.5: pre-warm the engine without running any inference.
    //      JS settings toggle calls this on app boot when the user has opted
    //      in. Engine + sampler config are loaded into memory so the first
    //      real `infer*` call doesn't pay the 5-15s cold-start cost.
    //      Throws if model is missing or all backends fail.
    AsyncFunction("prewarm") { () -> Void in
      try self.ensureLoaded()
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
    cacheDir: String,
    enableMtp: Bool
  ) -> Bool {
    logger.info("tryCreateEngine: backend=\(backend, privacy: .public) vision=\(visionBackend ?? "nil") audio=cpu mtp=\(enableMtp)")
    guard let settings = litert_lm_engine_settings_create(
      modelPath, backend, visionBackend, "cpu"
    ) else {
      logger.error("tryCreateEngine: settings_create returned NULL for backend=\(backend, privacy: .public)")
      return false
    }
    // KV cache size. Gemma 4 E2B (.litertlm) supports up to 32K tokens per the
    // litert-community model card. We set the published max so multi-turn chat
    // + 13 tool definitions + occasional image/audio attachments fit without
    // truncation. Memory cost on iPhone 15 Pro+ (8 GB RAM): ~1.5-2 GB working
    // set including model weights + KV cache + scratch — well under iOS
    // Jetsam pressure for our supported devices. Lower this to 8192 or 16384
    // if low-RAM iPhones report OOM kills.
    //
    // Previously 2048 to avoid an early DYNAMIC_UPDATE_SLICE bug in v0.11.0;
    // that bug was MTP-drafter shape mismatch, not max_num_tokens-related,
    // and is handled by the gpu+MTP / gpu / cpu fallback chain above.
    litert_lm_engine_settings_set_max_num_tokens(settings, 32768)
    litert_lm_engine_settings_set_cache_dir(settings, cacheDir)
    // MTP (multi-token prediction) — Gemma 4's official 2-3× decode speedup.
    // Google's guidance: enable on GPU backends universally; on CPU only for
    // E4B. Our model is E2B, so we only flip this on for GPU decoder paths.
    // Earlier we kept this off because v0.11.0 LiteRT-LM had a shape mismatch
    // (drafter K-tokens-per-step vs main K=1 slice → DYNAMIC_UPDATE_SLICE).
    // Re-enabling per-backend now that the entitlement issue is resolved and
    // GPU is exercisable on physical devices.
    litert_lm_engine_settings_set_enable_speculative_decoding(settings, enableMtp)

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
      //
      // MTP per Google's guidance: enable on GPU decoder paths universally.
      // E2B on CPU is NOT a recommended MTP target, so the cpu/* attempts
      // run without it. If the GPU+MTP path hits a v0.11.0 drafter shape
      // bug, we also retry GPU once with MTP=off before falling to cpu/gpu.
      let attempts: [(backend: String, vision: String?, mtp: Bool)] = [
        ("gpu", "gpu", true),   // primary: full Metal + MTP (2-3× decode)
        ("gpu", "gpu", false),  // GPU-only retry if MTP triggers the shape bug
        ("cpu", "gpu", false),  // vision encoder on GPU, decoder on CPU
        ("cpu", "cpu", false),  // pure CPU (simulator + unsupported devices)
      ]
      for attempt in attempts {
        if tryCreateEngine(
          modelPath: modelPath,
          backend: attempt.backend,
          visionBackend: attempt.vision,
          cacheDir: cacheDir,
          enableMtp: attempt.mtp,
        ) {
          self.loadedModelPath = modelPath
          logger.info("ensureLoaded: succeeded with backend=\(attempt.backend, privacy: .public) vision=\(attempt.vision ?? "nil") mtp=\(attempt.mtp)")
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

  // MARK: - Text streaming (Phase 1)

  /**
   * Build the same combined-prompt user message as `runTextInference`, then
   * kick off the C streaming API. Returns once the stream is **registered**;
   * actual chunk delivery happens via events on a background thread owned
   * by the LiteRT-LM engine.
   */
  private func startTextStream(requestId: String, requestJson: String) throws {
    logger.info("startTextStream: requestId=\(requestId, privacy: .public) json.len=\(requestJson.count)")

    // Reject duplicate requestIds — the caller is supposed to generate a
    // unique id per send. If we let two contexts share the same id we'd
    // leak the older one on cancel + spray its events into the new request.
    let alreadyActive: Bool = streamsQueue.sync {
      return self.activeStreams[requestId] != nil
    }
    if alreadyActive {
      throw NivocaAiError("duplicate_request", "Stream with requestId \(requestId) is already active")
    }

    guard let requestData = requestJson.data(using: .utf8) else {
      throw NivocaAiError("bad_request", "Request JSON is not valid UTF-8")
    }
    let request: TextInferRequest
    do {
      request = try JSONDecoder().decode(TextInferRequest.self, from: requestData)
    } catch {
      throw NivocaAiError("bad_request", "Failed to decode request: \(error.localizedDescription)")
    }

    let combinedPrompt = buildCombinedPrompt(request: request)
    logger.info("startTextStream: combinedPrompt.len=\(combinedPrompt.count) messages=\(request.messages.count) tools=\(request.tools?.count ?? 0)")

    try ensureLoaded()
    guard let engine = self.engine, let convConfig = self.convConfig else {
      throw NivocaAiError("not_ready", "Engine not initialized")
    }

    let (activeContent, tempFiles) =
      buildActiveContent(request: request, combinedPrompt: combinedPrompt)
    let payload: [String: Any] = [
      "role": "user",
      "content": activeContent,
    ]
    let payloadJson: String
    do {
      let data = try JSONSerialization.data(withJSONObject: payload, options: [])
      guard let s = String(data: data, encoding: .utf8) else {
        throw NivocaAiError("json_encode_failed", "Could not UTF-8 encode payload")
      }
      payloadJson = s
    } catch {
      throw NivocaAiError("json_encode_failed", "JSON serialization failed: \(error.localizedDescription)")
    }

    guard let conversation = litert_lm_conversation_create(engine, convConfig) else {
      // Engine is in a bad state after a prior failure (e.g. token-overflow
      // from a previous turn poisoned the conversation handle). Tear it down
      // so the NEXT call rebuilds from scratch via ensureLoaded.
      logger.error("startTextStream: conversation_create returned NULL — tearing down engine for recovery")
      loadQueue.sync { self.teardownEngine() }
      throw NivocaAiError("not_ready", "Could not create conversation")
    }

    let ctx = StreamContext(module: self, requestId: requestId, conversation: conversation)
    streamsQueue.sync {
      self.activeStreams[requestId] = ctx
    }
    // Schedule temp file cleanup once the stream finalizes — store the paths
    // on the StreamContext so the trampoline can rm them after is_final.
    ctx.tempFiles = tempFiles

    // Retain the context for the lifetime of the C stream — released in the
    // callback trampoline when is_final fires or an error is reported.
    let ctxPtr = Unmanaged<StreamContext>.passRetained(ctx).toOpaque()

    let started = Date()
    let rc = payloadJson.withCString { cstr -> Int32 in
      return litert_lm_conversation_send_message_stream(
        conversation, cstr, nil, nivocaAiStreamTrampoline, ctxPtr)
    }
    logger.info("startTextStream: send_message_stream rc=\(rc) in \(Date().timeIntervalSince(started))s")

    if rc != 0 {
      // Release the retain we just took — the callback will never fire.
      Unmanaged<StreamContext>.fromOpaque(ctxPtr).release()
      streamsQueue.sync { _ = self.activeStreams.removeValue(forKey: requestId) }
      litert_lm_conversation_delete(conversation)
      throw NivocaAiError("stream_start_failed", "send_message_stream returned rc=\(rc)")
    }
  }

  private func cancelTextStream(requestId: String) {
    logger.info("cancelTextStream: requestId=\(requestId, privacy: .public)")
    let ctx: StreamContext? = streamsQueue.sync { self.activeStreams[requestId] }
    guard let ctx = ctx else {
      logger.info("cancelTextStream: no active stream for requestId=\(requestId, privacy: .public)")
      return
    }
    ctx.cancelled = true
    if let conv = ctx.conversation {
      litert_lm_conversation_cancel_process(conv)
    }
  }

  /// Called from the C trampoline (any thread). Forwards the chunk to JS and
  /// performs cleanup on the final/error frame.
  fileprivate func handleStreamCallback(
    ctx: StreamContext, chunk: String?, isFinal: Bool, errorMsg: String?
  ) {
    if ctx.finished { return }

    if let errorMsg = errorMsg, !errorMsg.isEmpty {
      ctx.finished = true
      sendEvent("onInferStreamError", [
        "requestId": ctx.requestId,
        "message": errorMsg,
      ])
      teardownStream(ctx: ctx)
      return
    }

    if let chunk = chunk, !chunk.isEmpty {
      // Strip Gemma control tokens that the iOS XCFramework leaves in.
      let cleaned = stripGemmaControlTokens(chunk)
      if !cleaned.isEmpty {
        sendEvent("onInferStreamToken", [
          "requestId": ctx.requestId,
          "chunk": cleaned,
        ])
      }
    }

    if isFinal {
      ctx.finished = true
      sendEvent("onInferStreamDone", [
        "requestId": ctx.requestId,
        "cancelled": ctx.cancelled,
      ])
      teardownStream(ctx: ctx)
    }
  }

  private func teardownStream(ctx: StreamContext) {
    streamsQueue.sync {
      _ = self.activeStreams.removeValue(forKey: ctx.requestId)
    }
    if let conv = ctx.conversation {
      litert_lm_conversation_delete(conv)
      ctx.conversation = nil
    }
    for path in ctx.tempFiles {
      try? FileManager.default.removeItem(atPath: path)
    }
    ctx.tempFiles = []
  }

  /// Build the same flattened prompt as `runTextInference`. Extracted so the
  /// streaming variant shares the exact same prompt construction.
  /**
   * Build the combined prompt prefix (system tools + all prior turns minus
   * the live one). Caller appends the live user message and any media blocks
   * onto the returned text via the `content` array.
   */
  private func buildCombinedPrompt(request: TextInferRequest) -> String {
    var promptParts: [String] = []

    if let tools = request.tools, !tools.isEmpty {
      var toolsArr: [[String: Any]] = []
      for tool in tools {
        var entry: [String: Any] = [
          "name": tool.name,
          "description": tool.description,
        ]
        if let params = tool.parameters {
          entry["parameters"] = params.toJSONObject()
        }
        toolsArr.append(entry)
      }
      // Compact (no `.prettyPrinted`) — saves ~30-40% of the tool catalog
      // byte/token count by dropping whitespace. The model parses JSON fine.
      if let toolsData = try? JSONSerialization.data(withJSONObject: toolsArr),
         let toolsStr = String(data: toolsData, encoding: .utf8) {
        promptParts.append("Tools:\n\(toolsStr)")
      }
      promptParts.append(
        "Call format: <tool_call>{\"name\":\"...\",\"arguments\":{...}}</tool_call>. "
          + "Emit all related calls in one turn. Do not invent IDs — search or ask first."
      )
    }

    let lastUserIdx = request.messages.lastIndex { $0.role == "user" }
    for (i, msg) in request.messages.enumerated() {
      if i == lastUserIdx { continue }
      var msgText = ""
      for block in msg.content {
        if block.type == "text", let t = block.text {
          msgText += t
        }
      }
      if !msgText.isEmpty {
        promptParts.append("[\(msg.role)]\n\(msgText)")
      }
    }

    return promptParts.joined(separator: "\n\n")
  }

  /**
   * Build the active user-turn `content` array — text prompt plus any image
   * or audio blocks attached to the live user message. Returns the array and
   * the list of temp files written from base64 (for cleanup after inference).
   */
  private func buildActiveContent(
    request: TextInferRequest, combinedPrompt: String
  ) -> ([[String: Any]], [String]) {
    var content: [[String: Any]] = []
    var tempFiles: [String] = []

    let lastUserIdx = request.messages.lastIndex { $0.role == "user" }
    var lastUserText = ""
    if let idx = lastUserIdx {
      for block in request.messages[idx].content where block.type == "text" {
        if let t = block.text { lastUserText += t }
      }
    }
    let promptText = combinedPrompt.isEmpty
      ? lastUserText
      : (lastUserText.isEmpty ? combinedPrompt : "\(combinedPrompt)\n\n[user]\n\(lastUserText)")
    content.append(["type": "text", "text": promptText])

    if let idx = lastUserIdx {
      for block in request.messages[idx].content {
        if block.type == "image" || block.type == "audio" {
          do {
            let path = try resolveMediaPath(
              block: block, fallbackExt: block.type == "audio" ? "m4a" : "jpg")
            content.append(["type": block.type, "path": path])
            if block.path == nil, !path.isEmpty {
              tempFiles.append(path)
            }
          } catch {
            logger.error("buildActiveContent: skip \(block.type) block: \(error.localizedDescription)")
          }
        }
      }
    }

    return (content, tempFiles)
  }

  private func stripGemmaControlTokens(_ s: String) -> String {
    var out = s
    let controlTokens = [
      "<end_of_turn>",
      "<start_of_turn>model",
      "<start_of_turn>user",
      "<start_of_turn>",
      "<eos>",
    ]
    for tok in controlTokens {
      out = out.replacingOccurrences(of: tok, with: "")
    }
    return out
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
      logger.error("runInference: conversation_create returned NULL — tearing down engine")
      loadQueue.sync { self.teardownEngine() }
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

  // MARK: - Text inference (PoC)

  /**
   * Resolve an image / audio block into a file path the conversation API can
   * consume. Order of precedence:
   *   1. `block.path` — caller already wrote the file (preferred)
   *   2. `block.source` starting with `data:` — decode base64 to a temp file
   *   3. `block.source` looking like a file path — use it directly
   *
   * `fallbackExt` is used when we can't infer an extension from the data URL.
   */
  private func resolveMediaPath(
    block: TextInferRequest.ContentBlock, fallbackExt: String
  ) throws -> String {
    if let p = block.path, !p.isEmpty { return p }
    guard let source = block.source, !source.isEmpty else {
      throw NivocaAiError("bad_request", "media block has neither path nor source")
    }

    // Already a file path
    if source.hasPrefix("/") || source.hasPrefix("file://") {
      return source.hasPrefix("file://")
        ? String(source.dropFirst("file://".count))
        : source
    }

    // Data URL form: data:<mime>;base64,<payload>
    var ext = fallbackExt
    var base64Body = source
    if source.hasPrefix("data:") {
      if let commaRange = source.range(of: ",") {
        let header = source[source.index(source.startIndex, offsetBy: 5)..<commaRange.lowerBound]
        base64Body = String(source[commaRange.upperBound...])
        if let semi = header.range(of: ";") {
          let mime = String(header[..<semi.lowerBound])
          ext = extForMime(mime) ?? fallbackExt
        } else {
          ext = extForMime(String(header)) ?? fallbackExt
        }
      } else {
        throw NivocaAiError("bad_request", "malformed data URL (no comma)")
      }
    }

    guard let data = Data(base64Encoded: base64Body, options: .ignoreUnknownCharacters) else {
      throw NivocaAiError("bad_request", "invalid base64 in media block")
    }

    let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
    let filename = "nivoca-ai-\(UUID().uuidString).\(ext)"
    let url = cacheDir.appendingPathComponent(filename)
    try data.write(to: url, options: .atomic)
    return url.path
  }

  private func extForMime(_ mime: String) -> String? {
    switch mime.lowercased() {
    case "image/jpeg", "image/jpg": return "jpg"
    case "image/png": return "png"
    case "image/heic": return "heic"
    case "image/webp": return "webp"
    case "audio/m4a", "audio/x-m4a", "audio/mp4": return "m4a"
    case "audio/mpeg", "audio/mp3": return "mp3"
    case "audio/wav", "audio/x-wav", "audio/wave": return "wav"
    case "audio/ogg", "audio/opus": return "ogg"
    default: return nil
    }
  }

  /**
   * Phase 0 PoC implementation of `inferText`. Decodes the structured request,
   * flattens it into a single user-message payload (combining tools description
   * + system / assistant / user messages into one text body), and reuses the
   * existing conversation API path — same shape as OCR's `runInference`, minus
   * the image block.
   *
   * Rationale: the conversation API already accepts `{"role":"user","content":[
   * {"type":"text", "text":"..."}]}` payloads (validated by OCR). To verify
   * Gemma 4 E2B int4's function-calling capability quickly, we inject the tool
   * catalog as a JSON block inside the prompt text instead of patching the
   * chat template. If PoC scenarios pass (>=9/10 true positive) with this
   * prompt-only approach, Phase 1 can keep the same shape — no structural
   * template patch needed. If the model under-performs, Phase 1 adds the
   * `tools` parameter to `SimpleFormatMessages` for native chat-template
   * tool injection.
   */
  private func runTextInference(requestJson: String) throws -> String {
    logger.info("runTextInference: requestJson.len=\(requestJson.count)")

    guard let requestData = requestJson.data(using: .utf8) else {
      throw NivocaAiError("bad_request", "Request JSON is not valid UTF-8")
    }
    let request: TextInferRequest
    do {
      request = try JSONDecoder().decode(TextInferRequest.self, from: requestData)
    } catch {
      throw NivocaAiError("bad_request", "Failed to decode request: \(error.localizedDescription)")
    }

    let combinedPrompt = buildCombinedPrompt(request: request)
    logger.info("runTextInference: combinedPrompt.len=\(combinedPrompt.count) messages=\(request.messages.count) tools=\(request.tools?.count ?? 0)")

    try ensureLoaded()
    guard let engine = self.engine, let convConfig = self.convConfig else {
      throw NivocaAiError("not_ready", "Engine not initialized")
    }

    let (activeContent, tempFilesToClean) =
      buildActiveContent(request: request, combinedPrompt: combinedPrompt)
    let payload: [String: Any] = [
      "role": "user",
      "content": activeContent,
    ]
    defer {
      for path in tempFilesToClean {
        try? FileManager.default.removeItem(atPath: path)
      }
    }
    let payloadJson: String
    do {
      let payloadData = try JSONSerialization.data(withJSONObject: payload, options: [])
      guard let s = String(data: payloadData, encoding: .utf8) else {
        throw NivocaAiError("json_encode_failed", "Could not UTF-8 encode payload")
      }
      payloadJson = s
    } catch let err as NivocaAiError {
      throw err
    } catch {
      throw NivocaAiError("json_encode_failed", "JSON serialization failed: \(error.localizedDescription)")
    }

    // Fresh conversation per call — same state-pollution mitigation as OCR.
    guard let conversation = litert_lm_conversation_create(engine, convConfig) else {
      logger.error("runTextInference: conversation_create returned NULL — tearing down engine")
      loadQueue.sync { self.teardownEngine() }
      throw NivocaAiError("not_ready", "Could not create conversation")
    }
    defer { litert_lm_conversation_delete(conversation) }

    logger.info("runTextInference: calling conversation_send_message (blocking)")
    let started = Date()
    let response = payloadJson.withCString { cstr in
      litert_lm_conversation_send_message(conversation, cstr, nil)
    }
    let elapsed = Date().timeIntervalSince(started)

    guard let response = response else {
      logger.error("runTextInference: send_message returned NULL after \(elapsed)s")
      throw NivocaAiError(
        "generate_failed",
        "conversation_send_message returned NULL after \(elapsed)s")
    }
    defer { litert_lm_json_response_delete(response) }
    logger.info("runTextInference: send_message done in \(elapsed)s")

    guard let cstr = litert_lm_json_response_get_string(response) else {
      throw NivocaAiError("empty_response", "Response had no JSON payload")
    }
    let rawJson = String(cString: cstr)
    logger.info("runTextInference: rawJson.len=\(rawJson.count)")
    return extractTextFromResponse(rawJson)
  }
}

// MARK: - Stream callback plumbing

/**
 * Context for a single in-flight `inferTextStream` call. Held by both
 * `NivocaAiModule.activeStreams` (for cancel lookups) and by the C streaming
 * callback (as an `Unmanaged.passRetained` pointer). The callback releases
 * the retain when it observes is_final or an error; cancel signals the engine
 * via `litert_lm_conversation_cancel_process`, which causes the engine to
 * emit a final frame, which then runs the same cleanup path.
 */
fileprivate final class StreamContext {
  weak var module: NivocaAiModule?
  let requestId: String
  var conversation: OpaquePointer?
  var finished: Bool = false
  var cancelled: Bool = false
  /** Temp files written from base64 media — cleaned up after the stream ends. */
  var tempFiles: [String] = []
  init(module: NivocaAiModule, requestId: String, conversation: OpaquePointer) {
    self.module = module
    self.requestId = requestId
    self.conversation = conversation
  }
}

/**
 * C-ABI trampoline that the LiteRT-LM engine invokes for each chunk of a
 * streamed response. Decodes the user-data pointer back into a StreamContext,
 * forwards the chunk to the module via `handleStreamCallback`, and releases
 * the retain when the stream terminates.
 *
 * Must be `@convention(c)` (no captures) — LiteRT-LM stores it as a C
 * function pointer.
 */
fileprivate let nivocaAiStreamTrampoline: @convention(c) (
  UnsafeMutableRawPointer?, UnsafePointer<CChar>?, Bool, UnsafePointer<CChar>?
) -> Void = { rawData, chunkCstr, isFinal, errorCstr in
  guard let rawData = rawData else { return }
  let ctx = Unmanaged<StreamContext>.fromOpaque(rawData).takeUnretainedValue()
  let chunk: String? = chunkCstr.map { String(cString: $0) }
  let errorMsg: String? = errorCstr.map { String(cString: $0) }
  // Hand off to the module (which may forward to JS).
  if let module = ctx.module {
    module.handleStreamCallback(ctx: ctx, chunk: chunk, isFinal: isFinal, errorMsg: errorMsg)
  }
  // Terminal frame: release the retain established at stream start.
  if isFinal || (errorMsg != nil && !(errorMsg ?? "").isEmpty) {
    Unmanaged<StreamContext>.fromOpaque(rawData).release()
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
