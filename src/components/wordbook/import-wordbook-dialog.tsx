'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useBottomNavLock } from '@/hooks/use-bottom-nav-lock';
import { invalidateListCache } from '@/lib/list-cache';
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
  const [copyMode, setCopyMode] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyDescription, setCopyDescription] = useState('');
  useBottomNavLock(loading);

  if (!open || !wordbook) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      await repo.wordbooks.subscribe(wordbook.id);
      invalidateListCache('wordbooks');
      toast.success(t.wordbooks.subscribed);
      onDone();
    } catch {
      toast.error(t.common.error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartCopy = () => {
    setCopyName(wordbook.name);
    setCopyDescription(wordbook.description ?? '');
    setCopyMode(true);
  };

  const handleCopySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copyName.trim()) return;
    setLoading(true);
    try {
      await repo.wordbooks.copySharedWordbook(wordbook.id, {
        name: copyName.trim(),
        description: copyDescription.trim() || null,
      });
      invalidateListCache('wordbooks');
      invalidateListCache('words');
      toast.success(t.wordbooks.copied);
      handleClose();
      onDone();
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORDBOOK') {
        toast.error(t.wordbooks.duplicateWordbook);
      } else {
        toast.error(t.common.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCopyMode(false);
    setCopyName('');
    setCopyDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={loading ? undefined : handleClose} />
      <div className="relative z-50 w-full max-w-md rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        {copyMode ? (
          <form onSubmit={handleCopySubmit}>
            <h2 className="mb-4 text-lg font-semibold">{t.wordbooks.copyToMine}</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="copy-wordbook-name">{t.wordbooks.name}</Label>
                <Input
                  id="copy-wordbook-name"
                  value={copyName}
                  onChange={(e) => setCopyName(e.target.value)}
                  placeholder={t.wordbooks.namePlaceholder}
                  required
                  data-testid="import-copy-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="copy-wordbook-description">{t.wordbooks.description}</Label>
                <Input
                  id="copy-wordbook-description"
                  value={copyDescription}
                  onChange={(e) => setCopyDescription(e.target.value)}
                  placeholder={t.wordbooks.descriptionPlaceholder}
                  data-testid="import-copy-description-input"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setCopyMode(false)}
                disabled={loading}
              >
                {t.common.cancel}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading || !copyName.trim()}
                data-testid="import-copy-submit"
              >
                {loading ? <LoadingSpinner className="size-4" /> : t.common.save}
              </Button>
            </div>
          </form>
        ) : (
          <>
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
                onClick={handleStartCopy}
                disabled={loading}
                data-testid="import-copy-button"
              >
                {t.wordbooks.copyToMine}
              </Button>
            </div>

            <Button
              variant="ghost"
              className="mt-3 w-full"
              onClick={handleClose}
              disabled={loading}
            >
              {t.common.cancel}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
