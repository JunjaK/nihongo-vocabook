/**
 * Bridge between native `NivocaAi.inferTextStream` events and the
 * `AI_INFER_TOKEN / AI_INFER_DONE / AI_INFER_ERROR` messages the web app
 * consumes. Owns a singleton subscription to the three native event channels
 * so we don't double-register listeners on every WebView mount.
 *
 * Translation rules:
 *   onInferStreamToken { requestId, chunk }  → AI_INFER_TOKEN { requestId, delta }
 *   onInferStreamDone  { requestId, cancelled } → AI_INFER_DONE { requestId, fullText: '', finishReason: cancelled? 'error' : 'stop' }
 *   onInferStreamError { requestId, message } → AI_INFER_ERROR { requestId, code: 'native_stream_error', message }
 *
 * Note: `fullText` is intentionally empty — the web side accumulates deltas
 * itself (see `inference.ts` in the web app). Including the buffered full
 * text would force us to mirror state on the native side too.
 */

import NivocaAi from '../../../modules/nivoca-ai';
import type { NativeToWebMessage } from '../../types/bridge';

type SendToWeb = (message: NativeToWebMessage) => void;

let installedSender: SendToWeb | null = null;
let unsubscribers: Array<() => void> = [];

export function installStreamForwarder(sendToWeb: SendToWeb): void {
  // If the sender callback identity changes (e.g. WebView remount), tear
  // down old listeners first to avoid double-forwarding.
  if (installedSender === sendToWeb) return;
  uninstallStreamForwarder();
  installedSender = sendToWeb;

  const tokenSub = NivocaAi.addListener('onInferStreamToken', (payload) => {
    sendToWeb({
      type: 'AI_INFER_TOKEN',
      requestId: payload.requestId,
      delta: payload.chunk,
    });
  });
  const doneSub = NivocaAi.addListener('onInferStreamDone', (payload) => {
    sendToWeb({
      type: 'AI_INFER_DONE',
      requestId: payload.requestId,
      fullText: '',
      finishReason: payload.cancelled ? 'error' : 'stop',
    });
  });
  const errorSub = NivocaAi.addListener('onInferStreamError', (payload) => {
    sendToWeb({
      type: 'AI_INFER_ERROR',
      requestId: payload.requestId,
      code: 'native_stream_error',
      message: payload.message,
    });
  });

  unsubscribers = [
    () => tokenSub.remove(),
    () => doneSub.remove(),
    () => errorSub.remove(),
  ];
}

export function uninstallStreamForwarder(): void {
  for (const fn of unsubscribers) fn();
  unsubscribers = [];
  installedSender = null;
}

/** Convenience for the WebView message handler — wraps the native call. */
export async function startNativeStream(
  requestId: string,
  request: unknown,
): Promise<void> {
  const requestJson = JSON.stringify(request);
  await NivocaAi.inferTextStream(requestId, requestJson);
}

export async function cancelNativeStream(requestId: string): Promise<void> {
  await NivocaAi.cancelInferText(requestId);
}
