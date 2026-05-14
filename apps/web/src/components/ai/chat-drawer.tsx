'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { useChatStore } from '@/lib/ai/chat';
import type { ChatScope } from '@/types/chat';
import { ChatMessageList } from './chat-message-list';
import { ChatInputBar } from './chat-input-bar';

/**
 * Bottom-sheet chat surface for context-scoped chats (word / wordbook / quiz).
 * Built on Radix Dialog instead of vaul (project has not adopted vaul) — the
 * positioning + transform classes give a similar feel.
 *
 * Default height = 70vh. The user can tap the grabber to expand to full
 * screen (toggle 70 ↔ 95). True drag-to-resize is deferred to Phase 1.5.
 */
interface ChatDrawerProps {
  scope: ChatScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

function titleForScope(scope: ChatScope, t: ReturnType<typeof useTranslation>['t']): string {
  if (scope.kind === 'general') return t.assistant.title;
  return t.assistant.openContextChat;
}

export function ChatDrawer({ scope, open, onOpenChange, title }: ChatDrawerProps) {
  const { t } = useTranslation();
  const session = useChatStore((s) =>
    scope.kind === 'general'
      ? s.generalSession
      : s.contextSessions[
          scope.kind === 'word'
            ? `word:${scope.wordId}`
            : scope.kind === 'wordbook'
              ? `wordbook:${scope.wordbookId}`
              : `quiz:${scope.sessionId}`
        ],
  );
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40"
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl border-t bg-background shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2',
            'transition-[height] duration-200',
          )}
          style={{ height: expanded ? '95vh' : '70vh' }}
        >
          {/* Grabber */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-center pt-2 pb-1"
            aria-label="Toggle expand"
            data-testid="chat-drawer-grabber"
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </button>

          <div className="flex items-center justify-between border-b px-4 pb-3 pt-1">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title ?? titleForScope(scope, t)}
            </DialogPrimitive.Title>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label={t.assistant.cancel}
              data-testid="chat-drawer-close"
            >
              <XIcon className="size-icon" />
            </Button>
          </div>

          <ChatMessageList session={session} scope={scope} />
          <ChatInputBar scope={scope} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
