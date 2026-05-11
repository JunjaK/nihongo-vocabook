'use client';

import { createLogger } from '@/lib/logger';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

import {
  isNativeApp,
  onNativeMessage,
  sendToNative,
  type AiModelVariantId,
  type NativeToWebMessage,
} from '../native-bridge';
import { setModelStatus } from './model-manager';
import type { ModelStatus } from './types';

/**
 * Web ↔ Native AI bridge adapter.
 *
 * When the web app is running inside the Expo WebView (`isNativeApp() === true`)
 * we route the whole AI lifecycle — install / cancel / delete / infer — to the
 * native Expo module via the existing CustomEvent bridge. The web's own
 * transformers.js + WebGPU path stays in place as the desktop / Android
 * fallback; the chokepoint that picks the right backend lives in
 * `gemma-web.ts` (Phase C.4).
 *
 * Status updates from native are sinked into the existing
 * `apps/web/src/lib/ai/model-manager.ts` so the existing /settings/ocr UI
 * reacts without modification.
 */

const logger = createLogger('ai:native-bridge');

interface PendingInference {
  resolve: (words: ExtractedWord[]) => void;
  reject: (err: Error) => void;
  /** Cleanup handle for the AbortSignal listener — call to detach. */
  detachAbort?: () => void;
}

/** Active inference promises keyed by requestId so concurrent calls don't collide. */
const pending = new Map<string, PendingInference>();

/** Mirrors the latest `AI_MODEL_STATUS_RESULT.deviceSupported`. */
let lastDeviceSupported: boolean | undefined;
/** Mirrors the latest `AI_MODEL_STATUS_RESULT.modelName` for diagnostic copy. */
let lastModelName: string | undefined;
/** Which native variant the most recent STATUS refers to. Drives the
 *  "selected card" highlight on the settings page. */
let lastVariantId: AiModelVariantId | undefined;
/** Set to `true` once the first AI_MODEL_STATUS_RESULT has arrived. */
let bridgeInitialized = false;

let subscriptionInstalled = false;

type VariantListener = (variantId: AiModelVariantId | undefined) => void;
const variantListeners = new Set<VariantListener>();

function emitVariant(): void {
  for (const listener of variantListeners) listener(lastVariantId);
}

/**
 * Install the global `nativeMessage` listener exactly once. Safe to call from
 * many entry points (settings page mount, scan-store, the gemma-web delegator)
 * — repeated calls no-op.
 */
function ensureSubscription(): void {
  if (subscriptionInstalled) return;
  if (typeof window === 'undefined') return;
  if (!isNativeApp()) return;

  subscriptionInstalled = true;
  onNativeMessage((message) => {
    handleNativeMessage(message);
  });

  // Ask native for the current state on first install so we don't have to
  // wait for the unsolicited READY-time message.
  sendToNative({ type: 'AI_MODEL_STATUS' });
}

function handleNativeMessage(message: NativeToWebMessage): void {
  switch (message.type) {
    case 'AI_MODEL_STATUS_RESULT': {
      bridgeInitialized = true;
      lastDeviceSupported = message.deviceSupported;
      lastModelName = message.modelName;
      const prevVariant = lastVariantId;
      lastVariantId = message.variantId;
      setModelStatus(toWebModelStatus(message));
      if (prevVariant !== lastVariantId) emitVariant();
      break;
    }
    case 'AI_MODEL_DOWNLOAD_PROGRESS': {
      // The status result already drives the bar; the dedicated PROGRESS
      // event is informational and the web layer doesn't need to do anything
      // extra — we already sinked the loadedBytes/totalBytes from the
      // STATUS_RESULT that fires alongside it.
      break;
    }
    case 'AI_MODEL_DOWNLOAD_COMPLETE':
      setModelStatus({ state: 'installed' });
      break;
    case 'AI_MODEL_DOWNLOAD_FAILED':
      setModelStatus({ state: 'error', message: message.message });
      break;
    case 'AI_INFER_VISION_RESULT': {
      const entry = pending.get(message.requestId);
      if (entry) {
        entry.detachAbort?.();
        pending.delete(message.requestId);
        entry.resolve(message.words);
      }
      break;
    }
    case 'AI_INFER_VISION_FAILED': {
      const entry = pending.get(message.requestId);
      if (entry) {
        entry.detachAbort?.();
        pending.delete(message.requestId);
        entry.reject(new Error(message.message || 'native_infer_failed'));
      }
      break;
    }
    default:
      break;
  }
}

function toWebModelStatus(
  message: Extract<NativeToWebMessage, { type: 'AI_MODEL_STATUS_RESULT' }>,
): ModelStatus {
  switch (message.state) {
    case 'not_installed':
      return { state: 'not_installed' };
    case 'installed':
      return { state: 'installed' };
    case 'error':
      return { state: 'error', message: message.message ?? 'native_error' };
    case 'downloading':
      return {
        state: 'downloading',
        progress: message.progress ?? 0,
        loadedBytes: message.loadedBytes,
        totalBytes: message.totalBytes,
      };
  }
}

// ---------------------------------------------------------------------------
// Public API — consumed by gemma-web.ts (delegator) and /settings/ocr where
// needed (mostly the eligibility flag).
// ---------------------------------------------------------------------------

/**
 * Strip the `data:<mime>;base64,` prefix so the native side gets pure base64.
 * Native infers MIME from the file extension we write to disk anyway.
 */
function stripDataUrlPrefix(input: string): string {
  const comma = input.indexOf(',');
  return input.startsWith('data:') && comma !== -1 ? input.slice(comma + 1) : input;
}

export function isBridgeReady(): boolean {
  return isNativeApp() && bridgeInitialized;
}

export function isNativeReady(): boolean {
  ensureSubscription();
  // Wait until the bridge has sent at least one status update; otherwise we
  // can't distinguish "not installed" from "haven't asked yet".
  return false;
}

/**
 * Eligibility key for the localized i18n message. `null` means we're clear
 * to download. `null` when bridge hasn't reported yet, too — the settings
 * page should treat the disabled state as the safer default until then.
 */
export function nativeIneligibilityKey(): string | null {
  if (!bridgeInitialized) return null;
  if (lastDeviceSupported === false) return 'unsupportedIOS';
  return null;
}

export function nativeModelName(): string | undefined {
  return lastModelName;
}

export function triggerNativeDownload(variantId?: AiModelVariantId): void {
  ensureSubscription();
  sendToNative({ type: 'AI_MODEL_DOWNLOAD_START', variantId });
}

export function cancelNativeDownload(): void {
  sendToNative({ type: 'AI_MODEL_DOWNLOAD_CANCEL' });
}

export function deleteNativeModel(): void {
  sendToNative({ type: 'AI_MODEL_DELETE' });
}

/**
 * Tell native to update its variant *preference* without starting a download.
 * The native side persists the choice and re-emits status; the web UI
 * highlights the corresponding card.
 */
export function setNativeSelectedVariant(variantId: AiModelVariantId): void {
  ensureSubscription();
  sendToNative({ type: 'AI_MODEL_SET_VARIANT', variantId });
}

export function getNativeSelectedVariant(): AiModelVariantId | undefined {
  return lastVariantId;
}

export function subscribeNativeVariant(listener: VariantListener): () => void {
  variantListeners.add(listener);
  listener(lastVariantId);
  return () => {
    variantListeners.delete(listener);
  };
}

/**
 * Promise-based wrapper around the round-trip AI_INFER_VISION ↔ result.
 * Honors `AbortSignal` by rejecting the pending promise immediately and
 * letting the eventual native response (which can't be canceled) drop into
 * a no-op map miss.
 */
export function extractViaBridge(
  imageDataUrl: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  ensureSubscription();
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const requestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    let detachAbort: (() => void) | undefined;
    if (signal) {
      const onAbort = () => {
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId);
        entry.detachAbort?.();
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      detachAbort = () => signal.removeEventListener('abort', onAbort);
    }

    pending.set(requestId, { resolve: resolve as PendingInference['resolve'], reject, detachAbort });
    sendToNative({
      type: 'AI_INFER_VISION',
      requestId,
      imageBase64: stripDataUrlPrefix(imageDataUrl),
      locale,
    });
    logger.info('infer_dispatched', { requestId, locale });
  });
}

/** Boot the subscription on module load so the very first STATUS_RESULT lands. */
ensureSubscription();
