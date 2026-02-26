'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Wordbook, WordbookWithCount } from '@/types/wordbook';

interface AddToWordbookDialogProps {
  wordId: string;
  open: boolean;
  onClose: () => void;
}

export function AddToWordbookDialog({ wordId, open, onClose }: AddToWordbookDialogProps) {
  const repo = useRepository();
  const { t } = useTranslation();
  const [wordbooks, setWordbooks] = useState<WordbookWithCount[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      repo.wordbooks.getAll(),
      repo.wordbooks.getWordbooksForWord(wordId),
    ]).then(([all, current]) => {
      setWordbooks(all);
      setMemberOf(new Set(current.map((wb: Wordbook) => wb.id)));
      setLoading(false);
    });
  }, [open, repo, wordId]);

  const handleToggle = async (wordbookId: string) => {
    if (memberOf.has(wordbookId)) {
      await repo.wordbooks.removeWord(wordbookId, wordId);
      setMemberOf((prev) => {
        const next = new Set(prev);
        next.delete(wordbookId);
        return next;
      });
      toast.success(t.wordbooks.wordRemoved);
    } else {
      try {
        await repo.wordbooks.addWord(wordbookId, wordId);
        setMemberOf((prev) => new Set(prev).add(wordbookId));
        toast.success(t.wordbooks.wordAdded);
      } catch {
        toast.error(t.wordbooks.cannotAddMastered);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        <h2 className="mb-4 text-lg font-semibold">{t.wordbooks.selectWordbook}</h2>

        {loading ? (
          <div className="py-4 text-center text-muted-foreground">
            {t.common.loading}
          </div>
        ) : wordbooks.length === 0 ? (
          <div className="py-4 text-center text-muted-foreground">
            {t.wordbooks.noWordbooksYet}
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {wordbooks.map((wb) => {
              const isIn = memberOf.has(wb.id);
              return (
                <button
                  key={wb.id}
                  onClick={() => handleToggle(wb.id)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                  data-testid="wordbook-select-item"
                >
                  <div>
                    <div className="font-medium">{wb.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.wordbooks.wordCount(wb.wordCount)}
                    </div>
                  </div>
                  {isIn && (
                    <CheckIcon className="h-5 w-5 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={onClose}
        >
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
