/** The two LiteRT-LM variants we support — see `model-manager.ts`. */
export type AiModelVariantId = 'gemma-4-e2b' | 'gemma-4-e4b';

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
    };

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
    };
