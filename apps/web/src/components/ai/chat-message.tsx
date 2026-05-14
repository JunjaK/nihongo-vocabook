'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { getAttachmentPreviewUrl } from '@/lib/ai/chat';
import type { ChatMessage } from '@/types/chat';

interface BubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: BubbleProps) {
  if (message.role === 'user') return <UserBubble message={message} />;
  if (message.role === 'assistant') return <AssistantBubble message={message} />;
  if (message.role === 'tool') return <ToolResultBubble message={message} />;
  return null;
}

function ImageBlock({ attachmentId }: { attachmentId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    getAttachmentPreviewUrl(attachmentId)
      .then((u) => {
        if (cancelled) {
          if (u) URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);

  if (!url) {
    return (
      <div className="text-xs italic text-text-tertiary">
        {t.assistant.imageBlockedInHistory}
      </div>
    );
  }

  return (
    // Use img directly — local Object URL, dimensions unknown.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="max-h-64 max-w-full rounded-md object-cover"
    />
  );
}

function UserBubble({ message }: BubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">
        {message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <p key={i} className="whitespace-pre-wrap break-words text-sm">
                {block.text}
              </p>
            );
          }
          if (block.type === 'image') {
            return (
              <div key={i} className="mt-2 first:mt-0">
                <ImageBlock attachmentId={block.attachmentId} />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function AssistantBubble({ message }: BubbleProps) {
  const { t } = useTranslation();
  const isStreaming = message.status === 'streaming';
  const failed = message.status === 'failed';
  const text = message.content
    .filter((b): b is Extract<ChatMessage['content'][number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (failed) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {message.errorMessage ?? t.assistant.error.generateFailed}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[80%] rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground',
        )}
      >
        {text ? (
          <p className="whitespace-pre-wrap break-words">{text}</p>
        ) : isStreaming ? (
          <span className="inline-flex items-center gap-1 text-text-tertiary">
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            <span className="text-xs">{t.assistant.thinking}</span>
          </span>
        ) : null}
        {isStreaming && text && (
          <span
            className="ml-1 inline-block size-2 animate-pulse rounded-full bg-current align-baseline opacity-60"
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function ToolResultBubble({ message }: BubbleProps) {
  // Render compact summary of tool result. The detailed batch outcome is
  // already shown in the ToolConfirmCard; this bubble exists so the message
  // list reflects what the model saw next.
  const block = message.content[0];
  if (!block || block.type !== 'tool_result') return null;
  return (
    <div className="flex justify-center">
      <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 px-2.5 py-1 text-[11px] text-text-tertiary">
        {block.toolName}
      </div>
    </div>
  );
}
