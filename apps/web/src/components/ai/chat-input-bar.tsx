'use client';

import * as React from 'react';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoScan, XIcon } from '@/components/ui/icons';
import { storeAttachment, useChatStore } from '@/lib/ai/chat';
import type { ChatScope, ChatContentBlock } from '@/types/chat';

interface ChatInputBarProps {
  scope: ChatScope;
}

interface PendingAttachment {
  id: string;
  previewUrl: string;
}

export function ChatInputBar({ scope }: ChatInputBarProps) {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const activeInference = useChatStore((s) => s.activeInference);
  const cancelActive = useChatStore((s) => s.cancelActiveInference);

  const [text, setText] = React.useState('');
  const [pending, setPending] = React.useState<PendingAttachment[]>([]);
  const [sending, setSending] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isStreaming = activeInference !== null;

  const onAttachClick = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so same-file re-pick fires change
    if (!file) return;
    try {
      const id = await storeAttachment(file, { mimeType: file.type });
      const previewUrl = URL.createObjectURL(file);
      setPending((p) => [...p, { id, previewUrl }]);
    } catch (err) {
      console.error('attach failed', err);
    }
  };

  const removePending = (id: string) => {
    setPending((p) => {
      const removed = p.find((x) => x.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  };

  const onSubmit = async () => {
    if (sending || isStreaming) return;
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) return;

    const blocks: ChatContentBlock[] = [];
    for (const att of pending) {
      blocks.push({
        type: 'image',
        attachmentId: att.id,
        previewUrl: att.previewUrl,
      });
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
          {pending.map((att) => (
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
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onAttachClick}
          disabled={isStreaming}
          aria-label={t.assistant.attachImage}
          data-testid="chat-input-attach"
        >
          <PhotoScan className="size-icon" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFileChange}
        />
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
          className="flex-1"
          data-testid="chat-input-text"
        />
        {isStreaming ? (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => cancelActive()}
            aria-label={t.assistant.cancel}
            data-testid="chat-input-cancel"
          >
            <XIcon className="size-icon" />
          </Button>
        ) : (
          <Button
            onClick={() => void onSubmit()}
            disabled={sending || (!text.trim() && pending.length === 0)}
            data-testid="chat-input-send"
          >
            {t.assistant.send}
          </Button>
        )}
      </div>
    </div>
  );
}
