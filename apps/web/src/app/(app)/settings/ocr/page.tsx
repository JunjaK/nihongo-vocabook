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
import { checkDownloadEligibility, ensureGemmaReady } from '@/lib/ai/gemma-web';

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

export default function AiModelSettingsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(getModelStatus());
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [ineligibility, setIneligibility] = useState<string | null>(null);

  useEffect(() => subscribeModelStatus(setStatus), []);

  // One-time environment check so we can disable the download button up front
  // on iOS / non-WebGPU browsers instead of letting the user start a 1.5 GB
  // download that's going to fail at model-load time.
  useEffect(() => {
    let canceled = false;
    void checkDownloadEligibility().then((result) => {
      if (!canceled) setIneligibility(result);
    });
    return () => {
      canceled = true;
    };
  }, []);

  const localizeAiError = (message: string): string => {
    return message in t.aiModel
      ? (t.aiModel as Record<string, string>)[message]
      : message;
  };

  const handleDownload = () => {
    setDownloadPromptDismissed(false);
    ensureGemmaReady().catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : t.aiModel.downloadFailed;
      toast.error(localizeAiError(raw));
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

  const downloadBytesLabel =
    status.state === 'downloading' && status.totalBytes
      ? `${formatGB(status.loadedBytes ?? 0)} / ${formatGB(status.totalBytes)} GB`
      : null;
  const downloadSpeedLabel =
    status.state === 'downloading' && status.speedBps
      ? formatSpeed(status.speedBps)
      : null;
  const downloadEtaLabel =
    status.state === 'downloading' &&
    typeof status.etaSeconds === 'number' &&
    status.etaSeconds > 0
      ? `${t.aiModel.etaPrefix}${formatEta(status.etaSeconds)}`
      : null;

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
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${Math.round(status.progress * 100)}%` }}
                />
              </div>
              {(downloadBytesLabel || downloadSpeedLabel || downloadEtaLabel) && (
                <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                  <span>{downloadBytesLabel ?? ''}</span>
                  <span>
                    {[downloadSpeedLabel, downloadEtaLabel].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t.aiModel.approxSize}</span>
            <span>{t.aiModel.wifiRecommended}</span>
          </div>

          {status.state === 'error' && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
              data-testid="ai-model-error-notice"
            >
              {localizeAiError(status.message)}
            </p>
          )}
          {status.state !== 'error' && ineligibility && (
            <p
              className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
              data-testid="ai-model-eligibility-notice"
            >
              {localizeAiError(ineligibility)}
            </p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          {status.state !== 'installed' && (
            <Button
              className="w-full"
              onClick={handleDownload}
              disabled={
                status.state === 'downloading' || ineligibility !== null
              }
              data-testid="ai-model-download-button"
            >
              {status.state === 'error' ? t.aiModel.retry : t.aiModel.download}
            </Button>
          )}
          {(status.state === 'installed' ||
            status.state === 'downloading' ||
            status.state === 'error') && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
              data-testid="ai-model-delete-button"
            >
              {status.state === 'downloading'
                ? t.aiModel.cancelDownload
                : t.aiModel.delete}
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
