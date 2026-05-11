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

type WebToNativeMessage =
  | { type: 'READY'; bridgeVersion: number }
  | { type: 'AUTH_TOKEN'; refreshToken: string }
  | { type: 'REQUEST_CAMERA'; options?: { source: 'camera' | 'gallery' } }
  | { type: 'HAPTIC_FEEDBACK'; style: 'light' | 'medium' | 'heavy' }
  | { type: 'SET_BADGE_COUNT'; count: number }
  | { type: 'OPEN_EXTERNAL_URL'; url: string }
  | { type: 'SHARE'; text: string; url?: string }
  | { type: 'AI_MODEL_STATUS' }
  | { type: 'AI_MODEL_SET_VARIANT'; variantId: AiModelVariantId }
  | { type: 'AI_MODEL_DOWNLOAD_START'; variantId?: AiModelVariantId }
  | { type: 'AI_MODEL_DOWNLOAD_CANCEL' }
  | { type: 'AI_MODEL_DELETE' }
  | { type: 'AI_INFER_VISION'; requestId: string; imageBase64: string; locale: string };

interface AiExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

type AiModelState = 'not_installed' | 'downloading' | 'installed' | 'error';

type NativeToWebMessage =
  | { type: 'RESTORE_AUTH'; refreshToken: string }
  | { type: 'CAMERA_RESULT'; images: string[] }
  | { type: 'CAMERA_CANCELLED' }
  | { type: 'APP_INFO'; version: string; platform: 'ios' | 'android'; bridgeVersion: number }
  | { type: 'DEEP_LINK'; path: string }
  | { type: 'APP_STATE_CHANGE'; state: 'active' | 'background' | 'inactive' }
  | {
      type: 'AI_MODEL_STATUS_RESULT';
      state: AiModelState;
      variantId: AiModelVariantId;
      progress?: number;
      loadedBytes?: number;
      totalBytes?: number;
      message?: string;
      deviceSupported?: boolean;
      modelName?: string;
    }
  | { type: 'AI_MODEL_DOWNLOAD_PROGRESS'; progress: number; loadedBytes?: number; totalBytes?: number }
  | { type: 'AI_MODEL_DOWNLOAD_COMPLETE' }
  | { type: 'AI_MODEL_DOWNLOAD_FAILED'; message: string }
  | { type: 'AI_INFER_VISION_RESULT'; requestId: string; words: AiExtractedWord[] }
  | { type: 'AI_INFER_VISION_FAILED'; requestId: string; message: string };

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
