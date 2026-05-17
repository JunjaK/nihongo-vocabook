'use client';

import { createLogger } from '@/lib/logger';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

import {
  isNativeApp,
  onNativeMessage,
  sendToNative,
  type AiEngineInfo,
  type AiModelStatusSnapshot,
  type AiModelVariantId,
  type NativeToWebMessage,
} from '../native-bridge';
import { setSnapshot } from './model-manager';

/**
 * Web ↔ Native AI bridge adapter.
 *
 * The native shell owns the entire model lifecycle (download / activate /
 * delete / infer) for the multi-variant Gemma 4 setup. This module is the
 * web-side proxy: it forwards user actions through the CustomEvent bridge
 * and mirrors the native-emitted `AiModelStatusSnapshot` into the web
 * `model-manager` so the existing /settings/ocr UI can subscribe with
 * `subscribeSnapshot`.
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

/** Pending engine-info requests keyed by requestId. */
const pendingEngineInfo = new Map<
  string,
  { resolve: (info: AiEngineInfo) => void; reject: (err: Error) => void }
>();

/** Cached engine info — reset when the engine is torn down. */
let cachedEngineInfo: AiEngineInfo | null = null;

/** Mirrors the latest `AI_MODEL_STATUS_RESULT.deviceSupported`. */
let lastDeviceSupported: boolean | undefined;
/** Mirrors the latest `AI_MODEL_STATUS_RESULT.modelName` for diagnostic copy. */
let lastModelName: string | undefined;
/** Set to `true` once the first snapshot has arrived. */
let bridgeInitialized = false;

let subscriptionInstalled = false;

/**
 * Install the global `nativeMessage` listener exactly once.
 */
function ensureSubscription(): void {
  if (subscriptionInstalled) return;
  if (typeof window === 'undefined') return;
  if (!isNativeApp()) return;

  subscriptionInstalled = true;
  onNativeMessage((message) => {
    handleNativeMessage(message);
  });

  // Ask native for the current snapshot on first install so the UI doesn't
  // have to wait for the next unsolicited READY-time message.
  sendToNative({ type: 'AI_MODEL_STATUS' });
}

function handleNativeMessage(message: NativeToWebMessage): void {
  switch (message.type) {
    case 'AI_MODEL_STATUS_RESULT': {
      bridgeInitialized = true;
      lastDeviceSupported = message.deviceSupported;
      lastModelName = message.modelName;
      setSnapshot(message.snapshot);
      break;
    }
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
    case 'AI_ENGINE_INFO_RESULT': {
      const entry = pendingEngineInfo.get(message.requestId);
      if (entry) {
        pendingEngineInfo.delete(message.requestId);
        cachedEngineInfo = message.info;
        entry.resolve(message.info);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API — consumed by the settings page + the scan flow.
// ---------------------------------------------------------------------------

function stripDataUrlPrefix(input: string): string {
  const comma = input.indexOf(',');
  return input.startsWith('data:') && comma !== -1 ? input.slice(comma + 1) : input;
}

export function isBridgeReady(): boolean {
  return isNativeApp() && bridgeInitialized;
}

/**
 * Eligibility i18n key for the device-too-weak case, or `null` when the
 * device is supported / we haven't heard from native yet.
 */
export function nativeIneligibilityKey(): string | null {
  if (!bridgeInitialized) return null;
  if (lastDeviceSupported === false) return 'unsupportedDevice';
  return null;
}

export function nativeModelName(): string | undefined {
  return lastModelName;
}

export function triggerNativeDownload(variantId: AiModelVariantId): void {
  ensureSubscription();
  sendToNative({ type: 'AI_MODEL_DOWNLOAD_START', variantId });
}

export function cancelNativeDownload(): void {
  sendToNative({ type: 'AI_MODEL_DOWNLOAD_CANCEL' });
}

export function deleteNativeVariant(variantId: AiModelVariantId): void {
  resetEngineInfoCache();
  sendToNative({ type: 'AI_MODEL_DELETE', variantId });
}

/** Switch which installed variant is used for inference. No-op natively
 *  when the variant isn't installed (the UI gates the call). */
export function setNativeActiveVariant(variantId: AiModelVariantId): void {
  resetEngineInfoCache();
  ensureSubscription();
  sendToNative({ type: 'AI_MODEL_SET_ACTIVE', variantId });
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

    pending.set(requestId, {
      resolve: resolve as PendingInference['resolve'],
      reject,
      detachAbort,
    });
    sendToNative({
      type: 'AI_INFER_VISION',
      requestId,
      imageBase64: stripDataUrlPrefix(imageDataUrl),
      locale,
    });
    logger.info('infer_dispatched', { requestId, locale });
  });
}

/** Convenience: current snapshot's active variant. Used by the scan page
 *  to decide whether the model gate should fire. */
export function getActiveVariant(): AiModelVariantId | null {
  // The snapshot lives in the web model-manager; importing it back here
  // would create a cycle, so we expose this through that module instead.
  // Callers should subscribe via `subscribeSnapshot` for reactive reads.
  return null;
}

/**
 * Query the native engine for the context-size and backend selected by
 * `pickKVCacheSize()` at engine start. Cached per JS-context lifetime —
 * engine teardown / re-create is rare and we accept slightly stale values
 * rather than hammering the bridge per turn.
 *
 * On web (non-native) build returns the unknown/zero shape so callers fall
 * back to the default conservative budget.
 */
export function getEngineInfo(): Promise<AiEngineInfo> {
  if (cachedEngineInfo) return Promise.resolve(cachedEngineInfo);
  if (!isNativeApp()) {
    return Promise.resolve({ maxNumTokens: 0, backend: 'unknown', mtpEnabled: false });
  }
  ensureSubscription();
  return new Promise<AiEngineInfo>((resolve, reject) => {
    const requestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `einfo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const timer = setTimeout(() => {
      pendingEngineInfo.delete(requestId);
      reject(new Error('getEngineInfo timeout (3s)'));
    }, 3000);

    pendingEngineInfo.set(requestId, {
      resolve: (info) => {
        clearTimeout(timer);
        resolve(info);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    sendToNative({ type: 'AI_ENGINE_INFO', requestId });
  });
}

/**
 * Drop the cached engine info. Call when the engine is known to have been
 * torn down (variant switch, manual unload) so the next `getEngineInfo()`
 * fetches fresh values from the native side.
 */
export function resetEngineInfoCache(): void {
  cachedEngineInfo = null;
}

export type { AiEngineInfo };

/** Boot the subscription on module load so the very first STATUS_RESULT lands. */
ensureSubscription();
