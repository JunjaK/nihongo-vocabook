'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { ChatDrawer } from './chat-drawer';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/lib/ai/chat';
import { isNativeApp } from '@/lib/native-bridge';
import {
  isBridgeReady,
  nativeIneligibilityKey,
} from '@/lib/ai/native-bridge-adapter';
import { getSnapshot, subscribeSnapshot } from '@/lib/ai/model-manager';
import type { ChatScope } from '@/types/chat';

/**
 * Per-page entry point that opens a context-scoped chat drawer. Always
 * visible — when unavailable, tapping shows a toast explaining why
 * (matches the user's decision: "always-visible + redirect").
 */
interface Props {
  scope: ChatScope;
  /** Optional explicit disabled flag (e.g. quiz rating gate) */
  disabled?: boolean;
  /** Optional reason shown in toast when `disabled` is true */
  disabledReason?: string;
  testId?: string;
}

export function AssistantButton({ scope, disabled, disabledReason, testId }: Props) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const ensureSession = useChatStore((s) => s.ensureSession);

  const [snapshot, setSnapshotState] = useState(getSnapshot);
  useEffect(() => subscribeSnapshot(setSnapshotState), []);

  const [open, setOpen] = useState(false);

  const fallback = computeFallback({
    nativeApp: isNativeApp(),
    bridgeReady: isBridgeReady(),
    ineligibilityKey: nativeIneligibilityKey(),
    installedCount: snapshot.installed.length,
  });

  function handleClick() {
    if (disabled) {
      if (disabledReason) toast.info(disabledReason);
      return;
    }
    if (fallback === 'web-not-supported') {
      toast.info(t.assistant.fallback.webNotSupported);
      return;
    }
    if (fallback === 'device-too-weak') {
      toast.info(t.assistant.fallback.deviceTooWeak);
      return;
    }
    if (fallback === 'model-not-installed') {
      toast.info(t.assistant.fallback.modelNotInstalled);
      return;
    }
    if (!user) {
      toast.info(t.assistant.fallback.modelNotInstalled);
      return;
    }
    void ensureSession(scope);
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleClick}
        aria-label={t.assistant.openContextChat}
        data-testid={testId ?? 'assistant-open-button'}
      >
        <Sparkles className="size-icon" />
      </Button>
      <ChatDrawer scope={scope} open={open} onOpenChange={setOpen} />
    </>
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
