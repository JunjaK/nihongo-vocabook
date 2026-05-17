/** The two LiteRT-LM variants we support — see `model-manager.ts`. */
export type AiModelVariantId = 'gemma-4-e2b' | 'gemma-4-e4b';

/** Engine capability snapshot returned by `NivocaAi.getEngineInfo()` via the
 *  bridge. The web side uses this to size its token budget dynamically instead
 *  of hardcoding a conservative worst-case. */
export interface AiEngineInfo {
  maxNumTokens: number;
  backend: 'gpu' | 'cpu' | 'unknown';
  mtpEnabled: boolean;
}

/** Messages sent from Web (WebView) to Native (Expo) */
export type WebToNativeMessage =
  | { type: 'READY'; bridgeVersion: number }
  | { type: 'AUTH_TOKEN'; refreshToken: string }
  | { type: 'REQUEST_CAMERA'; options?: { source: 'camera' | 'gallery' } }
  | { type: 'HAPTIC_FEEDBACK'; style: 'light' | 'medium' | 'heavy' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'OPEN_EXTERNAL_URL'; url: string }
  | { type: 'SHARE'; text: string; url?: string }
  | { type: 'AI_MODEL_STATUS' }
  /** Choose which installed variant is used for inference. No-op if the
   *  variant isn't installed yet. */
  | { type: 'AI_MODEL_SET_ACTIVE'; variantId: AiModelVariantId }
  | { type: 'AI_MODEL_DOWNLOAD_START'; variantId: AiModelVariantId }
  /** Cancel the in-flight download (sequential policy — at most one). */
  | { type: 'AI_MODEL_DOWNLOAD_CANCEL' }
  | { type: 'AI_MODEL_DELETE'; variantId: AiModelVariantId }
  | {
      type: 'AI_INFER_VISION';
      requestId: string;
      imageBase64: string;
      locale: string;
    }
  | {
      type: 'AI_INFER';
      requestId: string;
      request: BridgeAiInferRequest;
    }
  | {
      type: 'AI_INFER_CANCEL';
      requestId: string;
    }
  /** Pre-warm the on-device engine without running inference. Fire-and-forget;
   *  failures are reported via a future AI_PREWARM_RESULT if we add one. */
  | { type: 'AI_PREWARM' }
  /** Query the native engine's capability snapshot (context size, backend,
   *  MTP flag). Reply: AI_ENGINE_INFO_RESULT. */
  | { type: 'AI_ENGINE_INFO'; requestId: string }
  /** Start recording audio via the native mic. Native emits TICK events while
   *  recording, RESULT on stop, CANCELLED if cancelled, ERROR on failure. */
  | { type: 'AUDIO_RECORD_START'; maxSeconds?: number }
  | { type: 'AUDIO_RECORD_STOP' }
  | { type: 'AUDIO_RECORD_CANCEL' }
  /** Open native document picker for audio files. */
  | { type: 'PICK_AUDIO_FILE' };

/** Bridge wire format for the multi-turn / function-calling inference call. */
export type BridgeAiInferContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: string }
  | { type: 'audio'; source: string; mimeType?: string }
  | { type: 'tool_result'; toolName: string; toolCallId: string; result: unknown };

export interface BridgeAiInferMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: BridgeAiInferContentBlock[];
}

export interface BridgeAiInferToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface BridgeAiInferRequest {
  messages: BridgeAiInferMessage[];
  tools?: BridgeAiInferToolDef[];
  options?: { maxOutputTokens?: number; temperature?: number };
}

export interface AiExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

/** Snapshot of the on-device model lifecycle. Sent to web on every status
 *  change so the UI can render per-variant cards without further round-trips. */
export interface AiModelStatusSnapshot {
  /** Which variants are present on disk. May be empty / one / both. */
  installed: AiModelVariantId[];
  /** The variant currently selected as the inference target.
   *  `null` when nothing is installed. */
  active: AiModelVariantId | null;
  /** Sequential download policy — at most one in flight at any time. */
  downloading: {
    variantId: AiModelVariantId;
    progress: number;
    loadedBytes?: number;
    totalBytes?: number;
  } | null;
  /** Sticky error tied to a specific variant. Cleared by retry / dismiss. */
  error: {
    variantId: AiModelVariantId;
    message: string;
  } | null;
}

/** Messages sent from Native (Expo) to Web (WebView) */
export type NativeToWebMessage =
  | { type: 'RESTORE_AUTH'; refreshToken: string }
  | { type: 'CAMERA_RESULT'; images: string[] }
  | { type: 'CAMERA_CANCELLED' }
  | {
      type: 'APP_INFO';
      version: string;
      platform: 'ios' | 'android';
      bridgeVersion: number;
    }
  | { type: 'DEEP_LINK'; path: string }
  | {
      type: 'APP_STATE_CHANGE';
      state: 'active' | 'background' | 'inactive';
    }
  | {
      type: 'AI_MODEL_STATUS_RESULT';
      /** Per-variant snapshot — the entire state machine, not a single state. */
      snapshot: AiModelStatusSnapshot;
      /** Result of the native device-eligibility whitelist (A15+ iPhone / M1+ iPad). */
      deviceSupported?: boolean;
      /** Marketing-style device name from `expo-device` (e.g. "iPhone 15 Pro"). */
      modelName?: string;
    }
  | {
      type: 'AI_INFER_VISION_RESULT';
      requestId: string;
      words: AiExtractedWord[];
    }
  | {
      type: 'AI_INFER_VISION_FAILED';
      requestId: string;
      message: string;
    }
  | {
      type: 'AI_INFER_TOKEN';
      requestId: string;
      delta: string;
    }
  | {
      type: 'AI_INFER_DONE';
      requestId: string;
      fullText: string;
      finishReason: 'stop' | 'length' | 'tool_call' | 'error';
      inputTokens?: number;
      outputTokens?: number;
      modelVariant?: string;
    }
  | {
      type: 'AI_INFER_ERROR';
      requestId: string;
      code: string;
      message: string;
    }
  /** Reply to AI_ENGINE_INFO. */
  | { type: 'AI_ENGINE_INFO_RESULT'; requestId: string; info: AiEngineInfo }
  /** Periodic update while recording — used to drive UI timer + level meter. */
  | { type: 'AUDIO_RECORD_TICK'; elapsedMs: number; level?: number }
  /** Recording finished successfully. base64 is the raw audio bytes. */
  | {
      type: 'AUDIO_RECORD_RESULT';
      base64: string;
      mimeType: string;
      durationMs: number;
    }
  | { type: 'AUDIO_RECORD_CANCELLED' }
  | { type: 'AUDIO_RECORD_ERROR'; message: string }
  /** Picked audio file from document picker. base64 = file bytes. */
  | {
      type: 'AUDIO_FILE_RESULT';
      base64: string;
      mimeType: string;
      name?: string;
    }
  | { type: 'AUDIO_FILE_CANCELLED' };
