'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useScanStore } from '@/stores/scan-store';
import { useAuthStore } from '@/stores/auth-store';
import { useChatStore } from '@/lib/ai/chat';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { isNativeApp, sendToNative } from '@/lib/native-bridge';
import { isBridgeReady } from '@/lib/ai/native-bridge-adapter';
import { getPrewarm, subscribeAssistantPrefs } from '@/lib/ai/assistant-prefs';
import { installTelemetryUploader } from '@/lib/ai/chat/telemetry-uploader';

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useTranslation();
  const repo = useRepository();
  const scanStatus = useScanStore((s) => s.status);
  const prevStatusRef = useRef(scanStatus);

  // ----- Scan-store cross-page toast (existing behavior) -----
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = scanStatus;
    if (
      scanStatus === 'preview' &&
      (prev === 'extracting' || prev === 'enriching') &&
      pathname !== '/words/scan'
    ) {
      toast.info(t.scan.extractionReady, {
        action: {
          label: t.scan.title,
          onClick: () => router.push('/words/scan'),
        },
      });
    }
  }, [scanStatus, pathname, router, t]);

  // ----- Chat store: hydrate after auth resolves; re-init when repo swaps.
  //
  // The repository instance is rebuilt by RepositoryProvider whenever the
  // signed-in user id changes (guestRepository ↔ SupabaseRepository). The
  // previous gate (`if (hydrated) return`) ran exactly once with whatever
  // repo happened to exist at mount time — usually `guestRepository`
  // because `authLoading` starts true. Every later message would then
  // call `guestRepository.chat.appendMessage` which throws LOGIN_REQUIRED,
  // is swallowed by the store's try/catch, and never reaches Supabase. UX
  // result: chat messages appear in the bubble but vanish on app reload.
  //
  // The fix waits for `authLoading` to resolve, then re-runs `init`
  // whenever the repo identity changes. `init` already overwrites the
  // store's `_repo` and re-fetches the current session.
  const authLoading = useAuthStore((s) => s.loading);
  const hydrated = useChatStore((s) => s.hydrated);
  const setLocale = useChatStore((s) => s.setLocale);
  const initChat = useChatStore((s) => s.init);

  useEffect(() => {
    if (authLoading) return;
    void initChat(repo, locale);
  }, [authLoading, repo, locale, initChat]);

  useEffect(() => {
    if (!hydrated) return;
    setLocale(locale);
  }, [locale, hydrated, setLocale]);

  // ----- Telemetry uploader: install once with the current repository -----
  useEffect(() => {
    return installTelemetryUploader(repo);
  }, [repo]);

  // ----- Pre-warm engine on boot when the toggle is ON -----
  // Fires once after the bridge becomes ready. Subsequent toggle flips also
  // re-trigger so the user can warm up the engine without restarting.
  useEffect(() => {
    if (!isNativeApp()) return;
    let didWarm = false;
    const tryWarm = () => {
      if (didWarm) return;
      if (!isBridgeReady()) return;
      if (!getPrewarm()) return;
      sendToNative({ type: 'AI_PREWARM' });
      didWarm = true;
    };
    tryWarm();
    // Re-attempt when bridge becomes ready later, or when the toggle flips.
    const interval = setInterval(tryWarm, 1500);
    const unsub = subscribeAssistantPrefs(() => {
      didWarm = false;
      tryWarm();
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, []);

  // ----- Chat cross-page notifications -----
  const activeInference = useChatStore((s) => s.activeInference);
  const pendingConfirms = useChatStore((s) => s.pendingConfirms);
  const prevActiveRef = useRef(activeInference);
  const prevPendingCountRef = useRef(pendingConfirms.length);

  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeInference;
    // Inference just finished
    if (prev && !activeInference && !pathname.startsWith('/assistant')) {
      toast.success(t.assistant.responseReady, {
        action: {
          label: t.common.view,
          onClick: () => router.push('/assistant'),
        },
      });
    }
  }, [activeInference, pathname, router, t]);

  useEffect(() => {
    const prevCount = prevPendingCountRef.current;
    const curCount = pendingConfirms.length;
    prevPendingCountRef.current = curCount;
    const newAwaiting = pendingConfirms.filter((b) => b.status === 'awaiting_confirm').length;
    if (curCount > prevCount && newAwaiting > 0 && !pathname.startsWith('/assistant')) {
      toast.info(t.assistant.toolConfirmNeeded(newAwaiting), {
        action: {
          label: t.common.review,
          onClick: () => router.push('/assistant'),
        },
      });
    }
  }, [pendingConfirms, pathname, router, t]);

  return (
    <div className="h-dvh bg-muted">
      <div className="mx-auto flex h-dvh max-w-md flex-col bg-background shadow-sm">
        {children}
      </div>
    </div>
  );
}
