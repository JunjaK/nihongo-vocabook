'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { SharedWordbookListItem } from '@/types/wordbook';

interface ImportWordbookDialogProps {
  wordbook: SharedWordbookListItem | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function ImportWordbookDialog({ wordbook, open, onClose, onDone }: ImportWordbookDialogProps) {
  const repo = useRepository();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  if (!open || !wordbook) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      await repo.wordbooks.subscribe(wordbook.id);
      toast.success(t.wordbooks.subscribed);
      onDone();
    } catch {
      toast.error(t.common.loading);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    setLoading(true);
    try {
      await repo.wordbooks.copySharedWordbook(wordbook.id);
      toast.success(t.wordbooks.copied);
      onDone();
    } catch {
      toast.error(t.common.loading);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={loading ? undefined : onClose} />
      <div className="relative z-50 w-full max-w-md rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        <h2 className="mb-1 text-lg font-semibold">{t.wordbooks.importTitle}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{wordbook.name}</p>
        <p className="mb-4 text-sm text-muted-foreground">{t.wordbooks.importDescription}</p>

        <div className="space-y-2">
          {!wordbook.isSubscribed && (
            <Button
              className="w-full"
              onClick={handleSubscribe}
              disabled={loading}
              data-testid="import-subscribe-button"
            >
              {t.wordbooks.subscribe}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleCopy}
            disabled={loading}
            data-testid="import-copy-button"
          >
            {t.wordbooks.copyToMine}
          </Button>
        </div>

        <Button
          variant="ghost"
          className="mt-3 w-full"
          onClick={onClose}
          disabled={loading}
        >
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}
