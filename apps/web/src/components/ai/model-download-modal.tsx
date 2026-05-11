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
  getModelStatus,
  setDownloadPromptDismissed,
  subscribeModelStatus,
} from '@/lib/ai/model-manager';

interface ModelDownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDownload: () => void;
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
  const progressPercent =
    status.state === 'downloading' ? Math.round(status.progress * 100) : 0;

  const handleDownload = () => {
    setDownloadPromptDismissed(false);
    onConfirmDownload();
  };

  const handleDismiss = () => {
    setDownloadPromptDismissed(true);
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.aiModel.promptTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.aiModel.promptDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {isDownloading && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="text-right text-xs tabular-nums text-muted-foreground">
              {progressPercent}% · {t.aiModel.statusDownloading}
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={handleDismiss}
            data-testid="ai-model-prompt-dismiss"
          >
            {t.aiModel.promptDismiss}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDownload}
            disabled={isDownloading}
            data-testid="ai-model-prompt-download"
          >
            {t.aiModel.promptDownload}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
