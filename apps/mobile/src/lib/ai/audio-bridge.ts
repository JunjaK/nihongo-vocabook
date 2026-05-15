/**
 * Native audio recording + file picking for the AI chat bridge.
 *
 * The web layer (inside the WebView) doesn't have microphone access on iOS,
 * so all recording happens here in the React Native shell. We expose a
 * minimal verb set (start/stop/cancel + pickFile) and emit progress + result
 * messages back to the web via the existing `sendToWeb` channel.
 */

import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import type { NativeToWebMessage } from '../../types/bridge';

type SendToWeb = (msg: NativeToWebMessage) => void;

const TICK_INTERVAL_MS = 200;
const DEFAULT_MAX_SECONDS = 30;

interface ActiveRecording {
  recorder: AudioRecorder;
  startedAt: number;
  maxSeconds: number;
  tickHandle: ReturnType<typeof setInterval>;
  autoStopHandle: ReturnType<typeof setTimeout>;
}

let active: ActiveRecording | null = null;

export async function startAudioRecording(
  sendToWeb: SendToWeb,
  maxSeconds: number = DEFAULT_MAX_SECONDS,
): Promise<void> {
  if (active) {
    sendToWeb({ type: 'AUDIO_RECORD_ERROR', message: 'already_recording' });
    return;
  }

  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) {
    sendToWeb({ type: 'AUDIO_RECORD_ERROR', message: 'permission_denied' });
    return;
  }

  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
  });

  const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
  try {
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch (err) {
    sendToWeb({
      type: 'AUDIO_RECORD_ERROR',
      message: err instanceof Error ? err.message : 'record_failed',
    });
    return;
  }

  const startedAt = Date.now();
  const tickHandle = setInterval(() => {
    if (!active) return;
    const elapsedMs = Date.now() - active.startedAt;
    sendToWeb({ type: 'AUDIO_RECORD_TICK', elapsedMs });
  }, TICK_INTERVAL_MS);

  const autoStopHandle = setTimeout(() => {
    void stopAudioRecording(sendToWeb);
  }, maxSeconds * 1000);

  active = { recorder, startedAt, maxSeconds, tickHandle, autoStopHandle };
}

export async function stopAudioRecording(sendToWeb: SendToWeb): Promise<void> {
  const current = active;
  if (!current) {
    sendToWeb({ type: 'AUDIO_RECORD_ERROR', message: 'not_recording' });
    return;
  }
  clearInterval(current.tickHandle);
  clearTimeout(current.autoStopHandle);
  active = null;

  try {
    await current.recorder.stop();
  } catch (err) {
    sendToWeb({
      type: 'AUDIO_RECORD_ERROR',
      message: err instanceof Error ? err.message : 'stop_failed',
    });
    return;
  }

  const uri = current.recorder.uri;
  if (!uri) {
    sendToWeb({ type: 'AUDIO_RECORD_ERROR', message: 'no_recording_uri' });
    return;
  }
  try {
    const base64 = await readFileAsBase64(uri);
    const durationMs = Date.now() - current.startedAt;
    sendToWeb({
      type: 'AUDIO_RECORD_RESULT',
      base64,
      mimeType: 'audio/m4a',
      durationMs,
    });
  } catch (err) {
    sendToWeb({
      type: 'AUDIO_RECORD_ERROR',
      message: err instanceof Error ? err.message : 'read_failed',
    });
  } finally {
    // Best-effort cleanup of the temp file written by the recorder.
    try {
      const f = new FileSystem.File(uri);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  }
}

export async function cancelAudioRecording(sendToWeb: SendToWeb): Promise<void> {
  const current = active;
  if (!current) return;
  clearInterval(current.tickHandle);
  clearTimeout(current.autoStopHandle);
  active = null;
  try {
    await current.recorder.stop();
  } catch {
    /* swallow — we're discarding anyway */
  }
  const uri = current.recorder.uri;
  if (uri) {
    try {
      const f = new FileSystem.File(uri);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  }
  sendToWeb({ type: 'AUDIO_RECORD_CANCELLED' });
}

export async function pickAudioFile(sendToWeb: SendToWeb): Promise<void> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) {
      sendToWeb({ type: 'AUDIO_FILE_CANCELLED' });
      return;
    }
    const asset = result.assets[0];
    const base64 = await readFileAsBase64(asset.uri);
    sendToWeb({
      type: 'AUDIO_FILE_RESULT',
      base64,
      mimeType: asset.mimeType ?? 'audio/m4a',
      name: asset.name,
    });
  } catch (err) {
    sendToWeb({
      type: 'AUDIO_RECORD_ERROR',
      message: err instanceof Error ? err.message : 'pick_failed',
    });
  }
}

async function readFileAsBase64(uri: string): Promise<string> {
  const file = new FileSystem.File(uri);
  if (!file.exists) throw new Error('audio file missing');
  return file.base64();
}
