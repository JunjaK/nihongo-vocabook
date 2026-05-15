'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { useChatStore } from '@/lib/ai/chat';
import { Sparkles } from '@/components/ui/icons';
import type { ChatMessage, ChatScope, ChatSession } from '@/types/chat';
import { ChatMessageBubble } from './chat-message';
import { ToolConfirmCard } from './tool-confirm-card';

interface ChatMessageListProps {
  session: ChatSession | null | undefined;
  scope: ChatScope;
}

export function ChatMessageList({ session, scope }: ChatMessageListProps) {
  const { t } = useTranslation();
  const pendingConfirms = useChatStore((s) => s.pendingConfirms);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  const messageCount = session?.messages.length ?? 0;
  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messageCount]);

  if (!session || session.messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-text-tertiary">
        <Sparkles className="mb-3 size-8 opacity-60" />
        <p className="text-sm">{t.assistant.emptyHint}</p>
      </div>
    );
  }

  // Map per-message confirm batches keyed by parent assistant messageId.
  const confirmsByMessage = new Map<string, typeof pendingConfirms>();
  for (const batch of pendingConfirms) {
    const arr = confirmsByMessage.get(batch.messageId) ?? [];
    arr.push(batch);
    confirmsByMessage.set(batch.messageId, arr);
  }

  const summarizedCount = session.summarizedMessageCount ?? 0;

  return (
    <div
      ref={scrollRef}
      className={cn('flex-1 overflow-y-auto px-4 py-3')}
      data-testid="chat-message-list"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {summarizedCount > 0 && (
          <div
            className="self-center rounded-full bg-secondary/60 px-3 py-1 text-[11px] text-text-tertiary"
            data-testid="chat-summary-indicator"
          >
            {t.assistant.summarizedNotice(summarizedCount)}
          </div>
        )}
        {session.messages.map((msg: ChatMessage) => (
          <React.Fragment key={msg.id}>
            <ChatMessageBubble message={msg} />
            {(confirmsByMessage.get(msg.id) ?? []).map((batch) => (
              <ToolConfirmCard key={batch.id} batch={batch} scope={scope} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
