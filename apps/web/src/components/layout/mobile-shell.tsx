'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useScanStore } from '@/stores/scan-store';
import { useChatStore } from '@/lib/ai/chat';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';

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

  // ----- Chat store: hydrate once, sync locale on change -----
  const hydrated = useChatStore((s) => s.hydrated);
  const setLocale = useChatStore((s) => s.setLocale);
  const initChat = useChatStore((s) => s.init);

  useEffect(() => {
    if (hydrated) return;
    void initChat(repo, locale);
  }, [hydrated, repo, locale, initChat]);

  useEffect(() => {
    if (!hydrated) return;
    setLocale(locale);
  }, [locale, hydrated, setLocale]);

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
