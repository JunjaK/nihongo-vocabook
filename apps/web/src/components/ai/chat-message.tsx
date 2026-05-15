'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { getAttachmentPreviewUrl } from '@/lib/ai/chat';
import { useChatStore } from '@/lib/ai/chat';
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
          if (block.type === 'audio') {
            return (
              <div key={i} className="mt-2 first:mt-0">
                <AudioBlock attachmentId={block.attachmentId} durationMs={block.durationMs} />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function AudioBlock({
  attachmentId,
  durationMs,
}: {
  attachmentId: string;
  durationMs?: number;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement>(null);

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
    <div className="flex items-center gap-2 rounded-md bg-background/20 px-2 py-1.5">
      <button
        type="button"
        onClick={toggle}
        className="flex size-7 items-center justify-center rounded-full bg-primary-foreground text-primary"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <span className="font-mono text-[11px] tabular-nums opacity-80">
        {formatAudioDuration(durationMs ?? 0)}
      </span>
      <audio
        ref={audioRef}
        src={url}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        preload="metadata"
        className="hidden"
      />
    </div>
  );
}

function formatAudioDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
      <div className="flex flex-col items-start gap-1">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <div>{message.errorMessage ?? t.assistant.error.generateFailed}</div>
          {message.errorCode && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide opacity-60">
              {message.errorCode}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={cn(
          'max-w-[80%] rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground',
        )}
      >
        {text ? (
          <MarkdownText text={text} />
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
      {!isStreaming && text && <FeedbackRow message={message} />}
    </div>
  );
}

// Compact markdown rendering for assistant bubbles. Tuned for chat density:
// no heading sizes, tight list spacing, code blocks scroll horizontally.
// Streaming-safe — react-markdown renders unterminated `**`/`_` as literal
// characters until the closer arrives, so per-token updates never flicker
// into broken layout.
const MARKDOWN_COMPONENTS = {
  p: (props: { children?: React.ReactNode }) => (
    <p className="my-1 whitespace-pre-wrap break-words first:mt-0 last:mb-0">
      {props.children}
    </p>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <ul className="my-1 ml-4 list-disc space-y-0.5 first:mt-0 last:mb-0">
      {props.children}
    </ul>
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <ol className="my-1 ml-4 list-decimal space-y-0.5 first:mt-0 last:mb-0">
      {props.children}
    </ol>
  ),
  li: (props: { children?: React.ReactNode }) => (
    <li className="break-words">{props.children}</li>
  ),
  strong: (props: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{props.children}</strong>
  ),
  em: (props: { children?: React.ReactNode }) => (
    <em className="italic">{props.children}</em>
  ),
  a: (props: { href?: string; children?: React.ReactNode }) => (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {props.children}
    </a>
  ),
  code: (props: { inline?: boolean; children?: React.ReactNode }) => {
    if (props.inline) {
      return (
        <code className="rounded bg-background/40 px-1 py-0.5 font-mono text-[0.85em]">
          {props.children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[0.85em]">{props.children}</code>
    );
  },
  pre: (props: { children?: React.ReactNode }) => (
    <pre className="my-1 overflow-x-auto rounded-md bg-background/40 p-2 first:mt-0 last:mb-0">
      {props.children}
    </pre>
  ),
  blockquote: (props: { children?: React.ReactNode }) => (
    <blockquote className="my-1 border-l-2 border-current/30 pl-2 italic opacity-90 first:mt-0 last:mb-0">
      {props.children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-current/20" />,
};

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="max-w-none break-words text-current">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function FeedbackRow({ message }: BubbleProps) {
  const { t } = useTranslation();
  const setMessageFeedback = useChatStore((s) => s.setMessageFeedback);
  const fb = message.feedback;

  const click = (next: 'thumbs_up' | 'thumbs_down') => {
    const value = fb === next ? null : next;
    void setMessageFeedback(message.id, value);
  };

  return (
    <div className="ml-1 flex items-center gap-1 text-text-tertiary">
      <button
        type="button"
        onClick={() => click('thumbs_up')}
        aria-pressed={fb === 'thumbs_up'}
        aria-label={t.assistant.feedbackThumbsUp}
        className={cn(
          'rounded-md p-1 transition-colors hover:bg-secondary',
          fb === 'thumbs_up' && 'text-primary dark:text-accent-muted',
        )}
        data-testid="chat-feedback-thumbs-up"
      >
        <ThumbsUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => click('thumbs_down')}
        aria-pressed={fb === 'thumbs_down'}
        aria-label={t.assistant.feedbackThumbsDown}
        className={cn(
          'rounded-md p-1 transition-colors hover:bg-secondary',
          fb === 'thumbs_down' && 'text-destructive',
        )}
        data-testid="chat-feedback-thumbs-down"
      >
        <ThumbsDownIcon className="size-3.5" />
      </button>
    </div>
  );
}

function ThumbsUpIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M2 21V9h4v12H2zm6 0V9.275l5.55-5.55a.97.97 0 0 1 .825-.225.99.99 0 0 1 .675.55.95.95 0 0 1 .125.475c.034.158.05.317.05.475l-.875 4H20a1.96 1.96 0 0 1 1.413.587A1.926 1.926 0 0 1 22 10.5q0 .2-.05.413a3.058 3.058 0 0 1-.1.387l-2.85 6.65A2.13 2.13 0 0 1 18.2 19c-.367.267-.767.4-1.2.4H8z" />
    </svg>
  );
}

function ThumbsDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22 3v12h-4V3h4zm-6 0v11.725l-5.55 5.55a.97.97 0 0 1-.825.225.99.99 0 0 1-.675-.55.95.95 0 0 1-.125-.475 2.94 2.94 0 0 1-.05-.475l.875-4H4a1.96 1.96 0 0 1-1.413-.588A1.926 1.926 0 0 1 2 13.5q0-.2.05-.413c.034-.142.067-.27.1-.387l2.85-6.65a2.13 2.13 0 0 1 .8-.95C6.167 4.833 6.567 4.7 7 4.7h9z" />
    </svg>
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
