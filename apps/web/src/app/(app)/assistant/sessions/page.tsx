'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Plus, Trash2 } from '@/components/ui/icons';
import { useTranslation } from '@/lib/i18n';
import { useChatStore } from '@/lib/ai/chat';
import { useAuthStore } from '@/stores/auth-store';
import { pageWrapper, scrollArea, emptyState, emptyIcon } from '@/lib/styles';
import type { ChatSession } from '@/types/chat';

export default function AssistantSessionsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const hydrated = useChatStore((s) => s.hydrated);
  const listGeneralSessions = useChatStore((s) => s.listGeneralSessions);
  const loadGeneralSession = useChatStore((s) => s.loadGeneralSession);
  const startNew = useChatStore((s) => s.startNewGeneralSession);
  const deleteSession = useChatStore((s) => s.deleteGeneralSession);

  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    listGeneralSessions(50).then((rows) => {
      if (!cancelled) setSessions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, listGeneralSessions]);

  const handleOpen = async (id: string) => {
    await loadGeneralSession(id);
    router.push('/assistant');
  };

  const handleNew = async () => {
    await startNew();
    router.push('/assistant');
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
      toast.success(t.common.complete);
    } catch (err) {
      toast.error(t.common.error);
      console.error(err);
    }
  };

  if (!user) {
    return (
      <div className={pageWrapper}>
        <Header title={t.assistant.sessionsTitle} showBack />
        <div className={emptyState}>{t.assistant.fallback.modelNotInstalled}</div>
      </div>
    );
  }

  return (
    <div className={pageWrapper}>
      <Header
        title={t.assistant.sessionsTitle}
        showBack
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleNew}
            aria-label={t.assistant.newChat}
            data-testid="assistant-sessions-new"
          >
            <Plus className="size-icon" />
          </Button>
        }
      />
      <div className={`${scrollArea} px-5 py-4`}>
        {sessions === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className={emptyState}>
            <Plus className={emptyIcon} />
            <div className="font-medium">{t.assistant.sessionsEmpty}</div>
            <Link href="/assistant" className="mt-3 text-sm text-primary dark:text-accent-muted">
              {t.assistant.newChat}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border bg-card p-3"
              >
                <button
                  type="button"
                  onClick={() => void handleOpen(s.id)}
                  className="flex flex-1 flex-col items-start text-left"
                  data-testid={`assistant-session-${s.id}`}
                >
                  <div className="line-clamp-1 text-sm font-medium">
                    {s.title || t.assistant.sessionsUntitled}
                  </div>
                  <div className="mt-0.5 text-xs text-text-tertiary tabular-nums">
                    {formatRelative(s.lastMessageAt ?? s.updatedAt, t)} · {t.assistant.sessionsMessageCount(s.messageCount)}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPendingDelete(s.id)}
                  aria-label={t.common.delete}
                  data-testid={`assistant-session-delete-${s.id}`}
                >
                  <Trash2 className="size-icon text-text-tertiary" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t.common.delete}
        description={t.assistant.sessionsDeleteConfirm}
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function formatRelative(timestamp: number, t: { assistant: { sessionsJustNow: string } }): string {
  const diff = Date.now() - timestamp;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t.assistant.sessionsJustNow;
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(timestamp).toLocaleDateString();
}
