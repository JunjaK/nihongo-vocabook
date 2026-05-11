'use client';

import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/lib/i18n';
import {
  deleteModel,
  getModelStatus,
  setDownloadPromptDismissed,
  subscribeModelStatus,
} from '@/lib/ai/model-manager';

interface ModelDownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDownload: () => void;
}

function formatGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

function formatSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function ModelDownloadModal({
  open,
  onOpenChange,
  onConfirmDownload,
}: ModelDownloadModalProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getModelStatus());

  useEffect(() => subscribeModelStatus(setStatus), []);

  const isDownloading = status.state === 'downloading';
  const isError = status.state === 'error';
  const progressPercent =
    status.state === 'downloading' ? Math.round(status.progress * 100) : 0;

  const bytesLabel =
    status.state === 'downloading' && status.totalBytes
      ? `${formatGB(status.loadedBytes ?? 0)} / ${formatGB(status.totalBytes)} GB`
      : null;
  const speedLabel =
    status.state === 'downloading' && status.speedBps
      ? formatSpeed(status.speedBps)
      : null;
  const etaLabel =
    status.state === 'downloading' &&
    typeof status.etaSeconds === 'number' &&
    status.etaSeconds > 0
      ? formatEta(status.etaSeconds)
      : null;

  const handleDownload = () => {
    setDownloadPromptDismissed(false);
    onConfirmDownload();
  };

  const handleDismiss = () => {
    // Only mark "don't prompt me again" when the user dismisses from the
    // initial prompt state. Hiding the progress modal mid-download is not a
    // refusal — they may simply want to do something else while it runs.
    if (status.state === 'not_installed') {
      setDownloadPromptDismissed(true);
    }
    onOpenChange(false);
  };

  const handleCancel = () => {
    void deleteModel();
    onOpenChange(false);
  };

  // Title/description shift to reflect the live state so users always know
  // what the modal is asking of them. When the error message is one of the
  // structured eligibility keys, render the localized human copy instead of
  // the raw key (and use a softer, non-failure title for those cases).
  const structuredError = (() => {
    if (status.state !== 'error') return null;
    // i18n table has function-valued entries; pick out only string ones.
    const table = t.aiModel as unknown as Record<string, string | undefined>;
    const localized = table[status.message];
    return typeof localized === 'string' ? localized : null;
  })();
  const title = isError
    ? (structuredError ? t.aiModel.promptTitle : t.aiModel.downloadFailed)
    : isDownloading
      ? t.aiModel.statusDownloading
      : t.aiModel.promptTitle;
  const description = isError
    ? (structuredError ?? status.message)
    : isDownloading
      ? t.aiModel.downloadInProgressDescription
      : t.aiModel.promptDescription;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {isDownloading && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
              <span>
                {bytesLabel ?? t.aiModel.statusDownloading}
              </span>
              <span>{progressPercent}%</span>
            </div>
            {(speedLabel || etaLabel) && (
              <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                <span>{speedLabel ?? ''}</span>
                <span>{etaLabel ? t.aiModel.etaPrefix + etaLabel : ''}</span>
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          {isDownloading ? (
            <>
              <AlertDialogCancel
                onClick={handleCancel}
                data-testid="ai-model-prompt-cancel"
              >
                {t.aiModel.cancelDownload}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onOpenChange(false)}
                data-testid="ai-model-prompt-hide"
              >
                {t.aiModel.hide}
              </AlertDialogAction>
            </>
          ) : isError ? (
            <>
              <AlertDialogCancel
                onClick={handleCancel}
                data-testid="ai-model-prompt-cancel"
              >
                {t.aiModel.delete}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDownload}
                data-testid="ai-model-prompt-retry"
              >
                {t.aiModel.retry}
              </AlertDialogAction>
            </>
          ) : (
            <>
              <AlertDialogCancel
                onClick={handleDismiss}
                data-testid="ai-model-prompt-dismiss"
              >
                {t.aiModel.promptDismiss}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDownload}
                data-testid="ai-model-prompt-download"
              >
                {t.aiModel.promptDownload}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
