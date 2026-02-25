'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';

export default function CreateWordbookPage() {
  const router = useRouter();
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
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

  const handleSubmit = async (values: { name: string; description: string | null; isShared?: boolean; tags?: string[] }) => {
    try {
      await repo.wordbooks.create(values);
      invalidateListCache('wordbooks');
      toast.success(t.wordbooks.wordbookCreated);
      router.push('/wordbooks');
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORDBOOK') {
        toast.error(t.wordbooks.duplicateWordbook);
      } else {
        throw err;
      }
    }
  };

  return (
    <>
      <Header
        title={t.wordbooks.createWordbook}
        showBack
        onBack={() => requestLeave(() => router.back())}
      />
      <WordbookForm
        onSubmit={handleSubmit}
        submitLabel={t.common.save}
        showShareToggle={!!user}
        onDirtyChange={setIsDirty}
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
