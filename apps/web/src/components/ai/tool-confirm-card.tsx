'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Check, XIcon } from '@/components/ui/icons';
import { useTranslation } from '@/lib/i18n';
import { useChatStore } from '@/lib/ai/chat';
import type { PendingToolBatch, PendingToolBatchItem, ChatScope } from '@/types/chat';
import type { Translations } from '@/lib/i18n/types';

interface ToolConfirmCardProps {
  batch: PendingToolBatch;
  /** Scope is reserved for future per-scope title customization. */
  scope: ChatScope;
}

function actionLabel(
  t: Translations['assistant']['toolCard']['actionFor'],
  toolName: string,
  args: Record<string, unknown>,
): string {
  const term = (args.term as string) ?? '';
  const name = (args.name as string) ?? '';
  const wbName = (args.wordbookId as string) ?? '';
  switch (toolName) {
    case 'add_word':
      return t.add_word(term);
    case 'edit_word':
      return t.edit_word;
    case 'delete_word':
      return t.delete_word(term);
    case 'set_mastered':
      return t.set_mastered(term, Boolean(args.mastered));
    case 'create_wordbook':
      return t.create_wordbook(name);
    case 'edit_wordbook':
      return t.edit_wordbook;
    case 'delete_wordbook':
      return t.delete_wordbook(name);
    case 'add_word_to_wordbook':
      return t.add_word_to_wordbook(term, wbName);
    case 'remove_word_from_wordbook':
      return t.remove_word_from_wordbook(term, wbName);
    default:
      return toolName;
  }
}

function itemSummary(item: PendingToolBatchItem): string {
  const { args } = item;
  const term = (args.term as string) ?? '';
  const reading = (args.reading as string) ?? '';
  const meaning = (args.meaning as string) ?? '';
  if (term) {
    const parts: string[] = [`${term}`];
    if (reading) parts.push(`(${reading})`);
    if (meaning) parts.push(`— ${meaning}`);
    return parts.join(' ');
  }
  if (args.name) return String(args.name);
  if (args.wordId) return `wordId: ${String(args.wordId)}`;
  return JSON.stringify(args);
}

export function ToolConfirmCard({ batch }: ToolConfirmCardProps) {
  const { t } = useTranslation();
  const toggleBatchItem = useChatStore((s) => s.toggleBatchItem);
  const setBatchItemsSelected = useChatStore((s) => s.setBatchItemsSelected);
  const removeBatchItem = useChatStore((s) => s.removeBatchItem);
  const approveBatch = useChatStore((s) => s.approveBatch);
  const cancelBatch = useChatStore((s) => s.cancelBatch);

  const selectedCount = batch.items.filter((i) => i.selected && i.status === 'pending').length;
  const isDone = batch.status === 'done';
  const isRunning = batch.status === 'running';
  const isAwaitingConfirm = batch.status === 'awaiting_confirm';

  const doneCount = batch.items.filter((i) => i.status === 'done').length;
  const failedCount = batch.items.filter((i) => i.status === 'failed').length;
  const skippedCount = batch.items.filter((i) => !i.selected).length;

  return (
    <div
      className="rounded-xl border bg-card p-3 shadow-sm"
      data-testid={`tool-confirm-card-${batch.toolName}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {t.assistant.toolCard.title(batch.items.length)}
        </div>
        {isAwaitingConfirm && batch.items.length > 1 && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBatchItemsSelected(batch.id, true)}
            >
              {t.common.selectAll}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBatchItemsSelected(batch.id, false)}
            >
              {t.common.deselectAll}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {batch.items.map((item) => {
          const label = actionLabel(t.assistant.toolCard.actionFor, batch.toolName, item.args);
          const isChecked = item.selected;
          return (
            <div
              key={item.callId}
              role={isAwaitingConfirm ? 'checkbox' : undefined}
              aria-checked={isChecked}
              tabIndex={isAwaitingConfirm ? 0 : -1}
              onClick={
                isAwaitingConfirm
                  ? () => toggleBatchItem(batch.id, item.callId)
                  : undefined
              }
              onKeyDown={(e) => {
                if (!isAwaitingConfirm) return;
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  toggleBatchItem(batch.id, item.callId);
                }
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg border p-2 text-xs transition-colors',
                isAwaitingConfirm && 'cursor-pointer hover:bg-accent',
                isChecked && isAwaitingConfirm
                  ? 'border-primary/20 bg-primary/[0.03]'
                  : isAwaitingConfirm
                    ? 'border-transparent opacity-60'
                    : '',
                item.status === 'failed' && 'border-destructive/30',
                item.status === 'done' && 'border-emerald-500/30',
              )}
              data-testid={`tool-confirm-item-${item.callId}`}
            >
              {isAwaitingConfirm && (
                <div
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    isChecked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30',
                  )}
                >
                  {isChecked && <Check className="size-3.5" strokeWidth={3} />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{label}</div>
                <div className="truncate text-text-tertiary">{itemSummary(item)}</div>
                {item.error && (
                  <div className="mt-0.5 text-destructive">{item.error}</div>
                )}
              </div>
              {isAwaitingConfirm && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBatchItem(batch.id, item.callId);
                  }}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Remove"
                >
                  <XIcon className="size-3" />
                </button>
              )}
              {item.status === 'done' && (
                <Check className="size-4 shrink-0 text-emerald-600" />
              )}
              {item.status === 'failed' && (
                <XIcon className="size-4 shrink-0 text-destructive" />
              )}
            </div>
          );
        })}
      </div>

      {isAwaitingConfirm && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => cancelBatch(batch.id)}
          >
            {t.assistant.cancel}
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              void approveBatch(batch.id);
            }}
            disabled={selectedCount === 0}
            data-testid={`tool-confirm-execute-${batch.toolName}`}
          >
            {t.assistant.toolCard.execute(selectedCount)}
          </Button>
        </div>
      )}

      {isRunning && (
        <div className="mt-2 text-xs text-text-tertiary">
          {t.assistant.toolCard.statusRunning}
        </div>
      )}
      {isDone && (
        <div className="mt-2 text-xs text-text-tertiary">
          {failedCount === 0 && skippedCount === 0
            ? t.assistant.toolCard.statusDone(doneCount)
            : t.assistant.toolCard.statusPartial(doneCount, failedCount, skippedCount)}
        </div>
      )}
    </div>
  );
}
