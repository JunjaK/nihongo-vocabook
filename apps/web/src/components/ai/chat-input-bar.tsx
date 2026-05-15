'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoScan, XIcon, Send } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { storeAttachment, useChatStore } from '@/lib/ai/chat';
import {
  isNativeApp,
  onNativeMessage,
  sendToNative,
} from '@/lib/native-bridge';
import type { ChatScope, ChatContentBlock } from '@/types/chat';

interface ChatInputBarProps {
  scope: ChatScope;
}

interface PendingAttachment {
  id: string;
  kind: 'image' | 'audio';
  previewUrl: string;
  durationMs?: number;
  mimeType: string;
}

const MAX_RECORD_SECONDS = 30;

export function ChatInputBar({ scope }: ChatInputBarProps) {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const activeInference = useChatStore((s) => s.activeInference);
  const cancelActive = useChatStore((s) => s.cancelActiveInference);

  const [text, setText] = React.useState('');
  const [pending, setPending] = React.useState<PendingAttachment[]>([]);
  const [sending, setSending] = React.useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isStreaming = activeInference !== null;
  const isRecording = recordingElapsedMs !== null;

  // Native audio bridge events.
  React.useEffect(() => {
    if (!isNativeApp()) return;
    return onNativeMessage((msg) => {
      if (msg.type === 'AUDIO_RECORD_TICK') {
        setRecordingElapsedMs(msg.elapsedMs);
      } else if (msg.type === 'AUDIO_RECORD_RESULT') {
        void handleAudioBlob(msg.base64, msg.mimeType, msg.durationMs);
        setRecordingElapsedMs(null);
      } else if (msg.type === 'AUDIO_FILE_RESULT') {
        void handleAudioBlob(msg.base64, msg.mimeType);
      } else if (msg.type === 'AUDIO_RECORD_CANCELLED') {
        setRecordingElapsedMs(null);
      } else if (msg.type === 'AUDIO_FILE_CANCELLED') {
        // no-op
      } else if (msg.type === 'AUDIO_RECORD_ERROR') {
        setRecordingElapsedMs(null);
        if (msg.message === 'permission_denied') {
          toast.error(t.assistant.error.micPermissionDenied);
        } else {
          toast.error(t.assistant.error.recordFailed);
          console.warn('[audio]', msg.message);
        }
      }
    });
  }, [t]);

  async function handleAudioBlob(base64: string, mimeType: string, durationMs?: number) {
    try {
      const blob = base64ToBlob(base64, mimeType);
      const id = await storeAttachment(blob, { mimeType });
      const previewUrl = URL.createObjectURL(blob);
      setPending((p) => [
        ...p,
        { id, kind: 'audio', previewUrl, durationMs, mimeType },
      ]);
    } catch (err) {
      console.error('audio attach failed', err);
      toast.error(t.assistant.error.attachFailed);
    }
  }

  const onAttachClick = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so same-file re-pick fires change
    if (!file) return;
    try {
      const kind = file.type.startsWith('audio/') ? 'audio' : 'image';
      const id = await storeAttachment(file, { mimeType: file.type });
      const previewUrl = URL.createObjectURL(file);
      setPending((p) => [
        ...p,
        { id, kind, previewUrl, mimeType: file.type },
      ]);
    } catch (err) {
      console.error('attach failed', err);
      toast.error(t.assistant.error.attachFailed);
    }
  };

  const removePending = (id: string) => {
    setPending((p) => {
      const removed = p.find((x) => x.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  };

  const startRecording = () => {
    if (!isNativeApp()) {
      toast.info(t.assistant.error.recordNotSupportedOnWeb);
      return;
    }
    setRecordingElapsedMs(0);
    sendToNative({ type: 'AUDIO_RECORD_START', maxSeconds: MAX_RECORD_SECONDS });
  };

  const stopRecording = () => {
    sendToNative({ type: 'AUDIO_RECORD_STOP' });
  };

  const cancelRecording = () => {
    sendToNative({ type: 'AUDIO_RECORD_CANCEL' });
    setRecordingElapsedMs(null);
  };

  const onSubmit = async () => {
    if (sending || isStreaming || isRecording) return;
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;

    const blocks: ChatContentBlock[] = [];
    for (const att of pending) {
      if (att.kind === 'image') {
        blocks.push({
          type: 'image',
          attachmentId: att.id,
          previewUrl: att.previewUrl,
        });
      } else {
        blocks.push({
          type: 'audio',
          attachmentId: att.id,
          previewUrl: att.previewUrl,
          durationMs: att.durationMs,
          mimeType: att.mimeType,
        });
      }
    }
    if (trimmed) blocks.push({ type: 'text', text: trimmed });

    setText('');
    setPending([]);
    setSending(true);
    try {
      await sendMessage(scope, blocks);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t bg-background px-3 pb-3 pt-2">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((att) =>
            att.kind === 'image' ? (
              <div key={att.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.previewUrl}
                  alt=""
                  className="size-14 rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePending(att.id)}
                  className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                  aria-label="Remove"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ) : (
              <AudioChip
                key={att.id}
                src={att.previewUrl}
                durationMs={att.durationMs}
                onRemove={() => removePending(att.id)}
              />
            ),
          )}
        </div>
      )}

      {isRecording ? (
        <RecordingBar
          elapsedMs={recordingElapsedMs ?? 0}
          maxMs={MAX_RECORD_SECONDS * 1000}
          onStop={stopRecording}
          onCancel={cancelRecording}
          stopLabel={t.assistant.recordStop}
          cancelLabel={t.assistant.recordCancel}
        />
      ) : (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            onClick={onAttachClick}
            disabled={isStreaming}
            aria-label={t.assistant.attachImage}
            data-testid="chat-input-attach"
          >
            <PhotoScan className="size-icon" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            onClick={startRecording}
            disabled={isStreaming}
            aria-label={t.assistant.recordAudio}
            data-testid="chat-input-mic"
          >
            <MicIcon className="size-icon" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*"
            className="hidden"
            onChange={onFileChange}
          />
          {/* Input + send button as a single visual unit. The button sits
              inside the input on the right, eliminating height mismatches. */}
          <div className="relative flex-1">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
              placeholder={t.assistant.inputPlaceholder}
              disabled={isStreaming}
              className="pr-12"
              data-testid="chat-input-text"
            />
            <button
              type="button"
              onClick={() => (isStreaming ? cancelActive() : void onSubmit())}
              disabled={
                !isStreaming && (sending || (!text.trim() && pending.length === 0))
              }
              aria-label={isStreaming ? t.assistant.cancel : t.assistant.send}
              data-testid={isStreaming ? 'chat-input-cancel' : 'chat-input-send'}
              className={cn(
                'absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md transition-all',
                'bg-primary text-primary-foreground',
                'enabled:active:scale-95',
                'disabled:opacity-30 disabled:cursor-not-allowed',
              )}
            >
              {isStreaming ? (
                <XIcon className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingBar({
  elapsedMs,
  maxMs,
  onStop,
  onCancel,
  stopLabel,
  cancelLabel,
}: {
  elapsedMs: number;
  maxMs: number;
  onStop: () => void;
  onCancel: () => void;
  stopLabel: string;
  cancelLabel: string;
}) {
  const pct = Math.min(100, (elapsedMs / maxMs) * 100);
  return (
    <div className="flex items-center gap-2" data-testid="chat-input-recording">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onCancel}
        aria-label={cancelLabel}
        data-testid="chat-input-record-cancel"
      >
        <XIcon className="size-icon" />
      </Button>
      <div className="flex flex-1 items-center gap-2 rounded-full bg-secondary px-3 py-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        </span>
        <span className="font-mono text-xs tabular-nums">
          {formatDuration(elapsedMs)} / {formatDuration(maxMs)}
        </span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-background/70">
          <div
            className="absolute inset-y-0 left-0 bg-destructive transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <Button
        size="icon-sm"
        onClick={onStop}
        aria-label={stopLabel}
        data-testid="chat-input-record-stop"
      >
        <StopIcon className="size-icon" />
      </Button>
    </div>
  );
}

function AudioChip({
  src,
  durationMs,
  onRemove,
}: {
  src: string;
  durationMs?: number;
  onRemove: () => void;
}) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="relative flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5">
      <button
        type="button"
        onClick={toggle}
        className="flex size-6 items-center justify-center rounded-full bg-foreground text-background"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
      </button>
      <span className="font-mono text-xs tabular-nums text-text-secondary">
        {formatDuration(durationMs ?? 0)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="-mr-1 flex size-5 items-center justify-center rounded-full hover:bg-background"
        aria-label="Remove"
      >
        <XIcon className="size-3" />
      </button>
      <audio
        ref={audioRef}
        src={src}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a1 1 0 0 1 2 0 7 7 0 0 1-6 6.92V21h-2v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}
