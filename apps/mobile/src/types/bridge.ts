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
  | { type: 'AI_MODEL_DOWNLOAD_START' }
  | { type: 'AI_MODEL_DOWNLOAD_CANCEL' }
  | { type: 'AI_MODEL_DELETE' }
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

export type AiModelState =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'error';

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
      state: AiModelState;
      /** 0..1, only present while state === 'downloading'. */
      progress?: number;
      /** Bytes streamed so far — drives the human "1.2 / 2.5 GB" label. */
      loadedBytes?: number;
      /** Reported by `URLSession`; may be undefined for chunked encodings. */
      totalBytes?: number;
      /** Localized error or structured key (e.g. "unsupported_device"). */
      message?: string;
      /** Result of the native device-eligibility whitelist (A15+ iPhone / M1+ iPad). */
      deviceSupported?: boolean;
      /** Marketing-style device name from `expo-device` (e.g. "iPhone 15 Pro"). */
      modelName?: string;
    }
  | {
      type: 'AI_MODEL_DOWNLOAD_PROGRESS';
      progress: number;
      loadedBytes?: number;
      totalBytes?: number;
    }
  | {
      type: 'AI_MODEL_DOWNLOAD_COMPLETE';
    }
  | {
      type: 'AI_MODEL_DOWNLOAD_FAILED';
      message: string;
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
