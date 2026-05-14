'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ChatMessageList } from '@/components/ai/chat-message-list';
import { ChatInputBar } from '@/components/ai/chat-input-bar';
import { AssistantFallback } from '@/components/ai/assistant-fallback';
import { useChatStore } from '@/lib/ai/chat';
import { isNativeApp } from '@/lib/native-bridge';
import {
  nativeIneligibilityKey,
  isBridgeReady,
} from '@/lib/ai/native-bridge-adapter';
import { getSnapshot, subscribeSnapshot } from '@/lib/ai/model-manager';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { pageWrapper } from '@/lib/styles';
import type { ChatScope } from '@/types/chat';

const GENERAL: ChatScope = { kind: 'general' };

export default function AssistantPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);

  const hydrated = useChatStore((s) => s.hydrated);
  const session = useChatStore((s) => s.generalSession);
  const markSessionViewed = useChatStore((s) => s.markSessionViewed);
  const clearGeneralSession = useChatStore((s) => s.clearGeneralSession);
  const [snapshot, setSnapshotState] = useState(getSnapshot);
  useEffect(() => subscribeSnapshot(setSnapshotState), []);
  const [confirmClear, setConfirmClear] = useState(false);

  // Mark unread cleared as soon as the page is in view.
  useEffect(() => {
    if (session?.id) markSessionViewed(session.id);
  }, [session?.id, markSessionViewed]);

  const variant = computeFallback({
    nativeApp: isNativeApp(),
    bridgeReady: isBridgeReady(),
    ineligibilityKey: nativeIneligibilityKey(),
    installedCount: snapshot.installed.length,
  });

  const handleClear = async () => {
    setConfirmClear(false);
    try {
      await clearGeneralSession();
      toast.success(t.common.complete);
    } catch (err) {
      toast.error(t.common.error);
      console.error(err);
    }
  };

  return (
    <div className={pageWrapper}>
      <Header
        title={t.assistant.title}
        actions={
          variant === null && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmClear(true)}
              aria-label={t.assistant.newChat}
              data-testid="assistant-new-chat-button"
              disabled={!session || session.messages.length === 0}
            >
              <Plus className="size-icon" />
            </Button>
          )
        }
      />

      {variant !== null ? (
        <div className="flex flex-1 flex-col">
          <AssistantFallback variant={variant} />
        </div>
      ) : !hydrated || authLoading ? (
        <div className="flex flex-1 items-center justify-center text-text-tertiary">
          {t.common.loading}
        </div>
      ) : !user ? (
        <div className="flex flex-1 items-center justify-center text-text-tertiary">
          {t.assistant.fallback.modelNotInstalled}
        </div>
      ) : (
        <>
          <ChatMessageList session={session} scope={GENERAL} />
          <ChatInputBar scope={GENERAL} />
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={t.assistant.newChat}
        description={t.assistant.newChatConfirm}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

function computeFallback(args: {
  nativeApp: boolean;
  bridgeReady: boolean;
  ineligibilityKey: string | null;
  installedCount: number;
}): 'web-not-supported' | 'device-too-weak' | 'model-not-installed' | null {
  if (!args.nativeApp) return 'web-not-supported';
  if (args.ineligibilityKey === 'unsupportedDevice') return 'device-too-weak';
  if (args.bridgeReady && args.installedCount === 0) return 'model-not-installed';
  return null;
}
