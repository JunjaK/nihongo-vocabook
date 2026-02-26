'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { WordForm } from '@/components/word/word-form';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { useAuthStore } from '@/stores/auth-store';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function CreateWordPage() {
  return (
    <Suspense>
      <CreateWordContent />
    </Suspense>
  );
}

function CreateWordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const repo = useRepository();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const sharedTerm = searchParams.get('term') ?? undefined;
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const requestLeave = useCallback((action: () => void) => {
    if (!isDirty) {
      action();
      return;
    }
    pendingLeaveRef.current = action;
    setShowLeaveConfirm(true);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return undefined;
    const handleDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = (e.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!target) return;

      const href = target.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (target.target && target.target !== '_self') return;

      e.preventDefault();
      requestLeave(() => {
        if (/^https?:\/\//.test(href)) {
          window.location.assign(href);
        } else {
          router.push(href);
        }
      });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [isDirty, requestLeave, router]);

  const handleConfirmLeave = () => {
    setShowLeaveConfirm(false);
    const next = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    next?.();
  };

  const handleCancelLeave = () => {
    setShowLeaveConfirm(false);
    pendingLeaveRef.current = null;
  };

  const handleSubmit = async (data: Parameters<typeof repo.words.create>[0]) => {
    try {
      await repo.words.create(data);
      invalidateListCache('words');
      toast.success(t.words.wordAdded);
      router.push('/words');
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
        toast.error(t.words.duplicateWord);
      } else {
        throw err;
      }
    }
  };

  return (
    <>
      <Header title={t.words.addWord} showBack onBack={() => requestLeave(() => router.back())} />
      <WordForm
        initialValues={sharedTerm ? { term: sharedTerm } : undefined}
        onSubmit={handleSubmit}
        submitLabel={t.words.addWord}
        onDirtyChange={setIsDirty}
        helperNotice={
          !user ? (
            <>
              {t.wordForm.loginRequiredTranslatedMeaning}{' '}
              <Link href="/login" className="underline underline-offset-2">
                {t.auth.signIn}
              </Link>
            </>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={showLeaveConfirm}
        icon={<AlertTriangle className="text-destructive" />}
        title={t.common.unsavedChangesTitle}
        description={t.common.unsavedChangesDescription}
        confirmLabel={t.common.leave}
        onConfirm={handleConfirmLeave}
        onCancel={handleCancelLeave}
      />
    </>
  );
}
