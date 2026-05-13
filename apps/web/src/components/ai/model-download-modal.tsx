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
import { getSnapshot, subscribeSnapshot } from '@/lib/ai/model-manager';

interface ModelDownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate to the AI model settings page. The modal no longer initiates
   *  downloads inline — multi-GB downloads belong in the dedicated settings
   *  UI where the user can pick a variant and see storage / progress. */
  onGoToSettings: () => void;
}

function formatGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

export function ModelDownloadModal({
  open,
  onOpenChange,
  onGoToSettings,
}: ModelDownloadModalProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshotState] = useState(getSnapshot());

  useEffect(() => subscribeSnapshot(setSnapshotState), []);

  const isDownloading = snapshot.downloading !== null;
  const isError = snapshot.error !== null;

  const handleGoToSettings = () => {
    onGoToSettings();
    onOpenChange(false);
  };

  const handleDismiss = () => {
    onOpenChange(false);
  };

  // Resolve a structured error key to its localized copy when possible.
  const structuredError = (() => {
    if (!snapshot.error) return null;
    const table = t.aiModel as unknown as Record<string, string | undefined>;
    const localized = table[snapshot.error.message];
    return typeof localized === 'string' ? localized : null;
  })();
  const title = isError
    ? structuredError
      ? t.aiModel.promptTitle
      : t.aiModel.downloadFailed
    : isDownloading
      ? t.aiModel.statusDownloading
      : t.aiModel.promptTitle;
  const description = isError
    ? structuredError ?? snapshot.error?.message ?? ''
    : isDownloading
      ? t.aiModel.downloadInProgressDescription
      : t.aiModel.promptDescriptionNeedsModel;

  const progressPercent =
    snapshot.downloading
      ? Math.round(snapshot.downloading.progress * 100)
      : 0;
  const bytesLabel =
    snapshot.downloading && snapshot.downloading.totalBytes
      ? `${formatGB(snapshot.downloading.loadedBytes ?? 0)} / ${formatGB(snapshot.downloading.totalBytes)} GB`
      : null;

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
              <span>{bytesLabel ?? t.aiModel.statusDownloading}</span>
              <span>{progressPercent}%</span>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          {isDownloading ? (
            <AlertDialogAction
              onClick={handleDismiss}
              data-testid="ai-model-prompt-hide"
            >
              {t.aiModel.hide}
            </AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel
                onClick={handleDismiss}
                data-testid="ai-model-prompt-dismiss"
              >
                {t.aiModel.promptDismiss}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleGoToSettings}
                data-testid="ai-model-prompt-go-to-settings"
              >
                {t.aiModel.goToSettings}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
