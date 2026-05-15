/**
 * Native bridge — communication layer between the web app (running in WebView)
 * and the native Expo app shell.
 *
 * The native app injects `window.NiVocaBridge` before content loads.
 * Web → Native: postMessage (discriminated union)
 * Native → Web: CustomEvent('nativeMessage')
 */

// ---------------------------------------------------------------------------
// Types (mirrored from apps/mobile/src/types/bridge.ts)
// ---------------------------------------------------------------------------

export type AiModelVariantId = 'gemma-4-e2b' | 'gemma-4-e4b';

/** Mirror of `apps/mobile/src/types/bridge.ts:AiModelStatusSnapshot`. */
export interface AiModelStatusSnapshot {
  installed: AiModelVariantId[];
  active: AiModelVariantId | null;
  downloading: {
    variantId: AiModelVariantId;
    progress: number;
    loadedBytes?: number;
    totalBytes?: number;
  } | null;
  error: { variantId: AiModelVariantId; message: string } | null;
}

/** A single content block in a chat message. Mirrors `AiContentBlock` in
 *  apps/web/src/types/chat.ts but uses a `source` field for images instead of
 *  attachmentId, because the bridge transports base64 directly. */
export type AiInferContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: string }
  /**
   * Audio attachment. `source` is a data URL or absolute file path that the
   * native side can resolve. Phase 2 plumbing — UI recording flow ships
   * separately once on-device audio inference is verified.
   */
  | { type: 'audio'; source: string; mimeType?: string }
  | { type: 'tool_result'; toolName: string; toolCallId: string; result: unknown };

export interface AiInferMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: AiInferContentBlock[];
}

export interface AiInferToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiInferRequest {
  messages: AiInferMessage[];
  tools?: AiInferToolDef[];
  options?: { maxOutputTokens?: number; temperature?: number };
}

type WebToNativeMessage =
  | { type: 'READY'; bridgeVersion: number }
  | { type: 'AUTH_TOKEN'; refreshToken: string }
  | { type: 'REQUEST_CAMERA'; options?: { source: 'camera' | 'gallery' } }
  | { type: 'HAPTIC_FEEDBACK'; style: 'light' | 'medium' | 'heavy' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'OPEN_EXTERNAL_URL'; url: string }
  | { type: 'SHARE'; text: string; url?: string }
  | { type: 'AI_MODEL_STATUS' }
  | { type: 'AI_MODEL_SET_ACTIVE'; variantId: AiModelVariantId }
  | { type: 'AI_MODEL_DOWNLOAD_START'; variantId: AiModelVariantId }
  | { type: 'AI_MODEL_DOWNLOAD_CANCEL' }
  | { type: 'AI_MODEL_DELETE'; variantId: AiModelVariantId }
  | { type: 'AI_INFER_VISION'; requestId: string; imageBase64: string; locale: string }
  | { type: 'AI_INFER'; requestId: string; request: AiInferRequest }
  | { type: 'AI_INFER_CANCEL'; requestId: string }
  | { type: 'AI_PREWARM' }
  | { type: 'AUDIO_RECORD_START'; maxSeconds?: number }
  | { type: 'AUDIO_RECORD_STOP' }
  | { type: 'AUDIO_RECORD_CANCEL' }
  | { type: 'PICK_AUDIO_FILE' };

interface AiExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

type NativeToWebMessage =
  | { type: 'RESTORE_AUTH'; refreshToken: string }
  | { type: 'CAMERA_RESULT'; images: string[] }
  | { type: 'CAMERA_CANCELLED' }
  | { type: 'APP_INFO'; version: string; platform: 'ios' | 'android'; bridgeVersion: number }
  | { type: 'DEEP_LINK'; path: string }
  | { type: 'APP_STATE_CHANGE'; state: 'active' | 'background' | 'inactive' }
  | {
      type: 'AI_MODEL_STATUS_RESULT';
      snapshot: AiModelStatusSnapshot;
      deviceSupported?: boolean;
      modelName?: string;
    }
  | { type: 'AI_INFER_VISION_RESULT'; requestId: string; words: AiExtractedWord[] }
  | { type: 'AI_INFER_VISION_FAILED'; requestId: string; message: string }
  | { type: 'AI_INFER_TOKEN'; requestId: string; delta: string }
  | {
      type: 'AI_INFER_DONE';
      requestId: string;
      fullText: string;
      finishReason: 'stop' | 'length' | 'tool_call' | 'error';
      inputTokens?: number;
      outputTokens?: number;
      modelVariant?: string;
    }
  | { type: 'AI_INFER_ERROR'; requestId: string; code: string; message: string }
  | { type: 'AUDIO_RECORD_TICK'; elapsedMs: number; level?: number }
  | { type: 'AUDIO_RECORD_RESULT'; base64: string; mimeType: string; durationMs: number }
  | { type: 'AUDIO_RECORD_CANCELLED' }
  | { type: 'AUDIO_RECORD_ERROR'; message: string }
  | { type: 'AUDIO_FILE_RESULT'; base64: string; mimeType: string; name?: string }
  | { type: 'AUDIO_FILE_CANCELLED' };

// ---------------------------------------------------------------------------
// Global type augmentation
// ---------------------------------------------------------------------------

interface NiVocaBridge {
  postMessage: (msg: WebToNativeMessage) => void;
  isNative: boolean;
  platform: 'ios' | 'android';
  bridgeVersion: number;
}

declare global {
  interface Window {
    NiVocaBridge?: NiVocaBridge;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const BRIDGE_VERSION = 1;

/** Check if the web app is running inside the native WebView */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.NiVocaBridge?.isNative;
}

/** Get the native platform ('ios' | 'android'), or null if not in native */
export function getNativePlatform(): 'ios' | 'android' | null {
  return window.NiVocaBridge?.platform ?? null;
}

/** Send a message to the native app */
export function sendToNative(message: WebToNativeMessage): void {
  window.NiVocaBridge?.postMessage(message);
}

/** Notify the native app that the web app is ready */
export function notifyReady(): void {
  sendToNative({ type: 'READY', bridgeVersion: BRIDGE_VERSION });
}

/** Send auth refresh token to native SecureStore for session persistence */
export function persistAuthToken(refreshToken: string): void {
  if (isNativeApp()) {
    sendToNative({ type: 'AUTH_TOKEN', refreshToken });
  }
}

/** Request native camera or gallery picker */
export function requestCamera(source: 'camera' | 'gallery' = 'camera'): void {
  sendToNative({ type: 'REQUEST_CAMERA', options: { source } });
}

/** Set native app badge count */
export function setBadgeCount(count: number): void {
  if (isNativeApp()) {
    sendToNative({ type: 'SET_BADGE_COUNT', count });
  }
}

/** Trigger haptic feedback on native */
export function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (isNativeApp()) {
    sendToNative({ type: 'HAPTIC_FEEDBACK', style });
  }
}

/**
 * Listen for messages from the native app.
 * Returns a cleanup function to remove the listener.
 */
export function onNativeMessage(
  handler: (msg: NativeToWebMessage) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<NativeToWebMessage>).detail);
  };
  window.addEventListener('nativeMessage', listener);
  return () => window.removeEventListener('nativeMessage', listener);
}

export type { WebToNativeMessage, NativeToWebMessage };
