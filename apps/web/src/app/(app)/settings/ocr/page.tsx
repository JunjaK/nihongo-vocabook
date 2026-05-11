'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/lib/i18n';
import {
  deleteModel,
  getModelStatus,
  setDownloadPromptDismissed,
  subscribeModelStatus,
} from '@/lib/ai/model-manager';
import { ensureGemmaReady } from '@/lib/ai/gemma-web';

export default function AiModelSettingsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getModelStatus());
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => subscribeModelStatus(setStatus), []);

  const handleDownload = () => {
    setDownloadPromptDismissed(false);
    ensureGemmaReady().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : t.aiModel.downloadFailed;
      toast.error(message);
    });
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteModel();
      toast.success(t.aiModel.deleteSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.aiModel.downloadFailed;
      toast.error(message);
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  const statusLabel =
    status.state === 'installed'
      ? t.aiModel.statusInstalled
      : status.state === 'downloading'
        ? `${t.aiModel.statusDownloading} ${Math.round(status.progress * 100)}%`
        : status.state === 'error'
          ? t.aiModel.downloadFailed
          : t.aiModel.statusNotInstalled;

  return (
    <>
      <Header title={t.settings.aiModelPage} showBack />
      <div className="animate-page flex-1 space-y-6 overflow-y-auto px-5 pt-3">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t.aiModel.title}</h2>
          <p className="text-sm text-muted-foreground">{t.aiModel.description}</p>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{t.aiModel.status}</div>
            <div
              className="text-sm tabular-nums text-muted-foreground"
              data-testid="ai-model-status"
            >
              {statusLabel}
            </div>
          </div>

          {status.state === 'downloading' && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t.aiModel.approxSize}</span>
            <span>{t.aiModel.wifiRecommended}</span>
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          {status.state !== 'installed' && (
            <Button
              className="w-full"
              onClick={handleDownload}
              disabled={status.state === 'downloading'}
              data-testid="ai-model-download-button"
            >
              {t.aiModel.download}
            </Button>
          )}
          {status.state === 'installed' && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
              data-testid="ai-model-delete-button"
            >
              {t.aiModel.delete}
            </Button>
          )}
        </section>

        <p className="pt-2 text-center text-xs text-muted-foreground">{t.aiModel.poweredBy}</p>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t.aiModel.delete}
        description={t.aiModel.deleteConfirm}
        confirmLabel={t.aiModel.delete}
        cancelLabel={t.aiModel.cancel}
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}
