'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { isNativeApp, type AiModelVariantId } from '@/lib/native-bridge';
import {
  deleteModel,
  getModelStatus,
  setDownloadPromptDismissed,
  subscribeModelStatus,
} from '@/lib/ai/model-manager';
import { checkDownloadEligibility, ensureGemmaReady } from '@/lib/ai/gemma-web';
import {
  getNativeSelectedVariant,
  setNativeSelectedVariant,
  subscribeNativeVariant,
  triggerNativeDownload,
} from '@/lib/ai/native-bridge-adapter';
import { getAiBlockedKey } from '@/lib/ai/runtime-gate';

/**
 * Hard-coded mirror of `apps/mobile/src/lib/ai/model-manager.ts` MODEL_VARIANTS.
 * Kept in sync by hand because the mobile package isn't imported into web.
 */
interface VariantSpec {
  id: AiModelVariantId;
  sizeGb: string;
  minRamGB: number;
}

const NATIVE_VARIANTS: VariantSpec[] = [
  { id: 'gemma-4-e2b', sizeGb: '2.41', minRamGB: 4 },
  { id: 'gemma-4-e4b', sizeGb: '3.41', minRamGB: 6 },
];

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
  const [confirmSwitchVariant, setConfirmSwitchVariant] =
    useState<AiModelVariantId | null>(null);
  const [ineligibility, setIneligibility] = useState<string | null>(null);
  const [nativeVariant, setNativeVariant] = useState<AiModelVariantId | undefined>(
    getNativeSelectedVariant(),
  );
  const [blockedKey, setBlockedKey] = useState<string | null>(null);

  const native = isNativeApp();

  useEffect(() => subscribeModelStatus(setStatus), []);
  useEffect(() => {
    if (!native) return;
    return subscribeNativeVariant(setNativeVariant);
  }, [native]);

  // Compute the runtime gate after mount so SSR doesn't disagree with the
  // first client render (window-based detection isn't safe at SSR time).
  useEffect(() => {
    setBlockedKey(getAiBlockedKey());
  }, []);

  useEffect(() => {
    if (blockedKey) return; // Don't even probe eligibility if we're blocked.
    let canceled = false;
    void checkDownloadEligibility().then((result) => {
      if (!canceled) setIneligibility(result);
    });
    return () => {
      canceled = true;
    };
  }, [blockedKey]);

  const localizeAiError = (message: string): string => {
    // i18n table has a few function-valued entries (parametric labels) that
    // can't be the target of a string-key lookup; cast through unknown to
    // keep TypeScript honest while still picking up flat string keys for
    // error codes like `unsupportedIOS`, `pwaBlocked`, etc.
    const table = t.aiModel as unknown as Record<string, string | undefined>;
    const localized = table[message];
    return typeof localized === 'string' ? localized : message;
  };

  const handleDownload = (variantId?: AiModelVariantId) => {
    setDownloadPromptDismissed(false);
    if (native && variantId) {
      triggerNativeDownload(variantId);
      return;
    }
    ensureGemmaReady().catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : t.aiModel.downloadFailed;
      toast.error(localizeAiError(raw));
    });
  };

  const handleSelectVariant = (variantId: AiModelVariantId) => {
    if (!native) return;
    if (status.state === 'installed' && nativeVariant !== variantId) {
      setConfirmSwitchVariant(variantId);
      return;
    }
    setNativeSelectedVariant(variantId);
    handleDownload(variantId);
  };

  const confirmSwitchAndDownload = () => {
    if (!confirmSwitchVariant) return;
    const target = confirmSwitchVariant;
    setConfirmSwitchVariant(null);
    setNativeSelectedVariant(target);
    // model-manager handles purging the old file before starting the new one.
    triggerNativeDownload(target);
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

  // Runtime-gate blocking screen — no download / inference machinery is
  // exposed when AI isn't allowed in the current runtime mode.
  if (blockedKey) {
    return (
      <>
        <Header title={t.settings.aiModelPage} showBack />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {localizeAiError(blockedKey)}
          </p>
        </div>
      </>
    );
  }

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
      <div className="animate-page flex-1 space-y-6 overflow-y-auto px-5 pt-3 pb-6">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {native ? t.aiModel.nativeTitle : t.aiModel.title}
          </h2>
          <p className="text-sm text-muted-foreground">{t.aiModel.description}</p>
        </section>

        <Separator />

        <section className="space-y-3" data-testid="ai-model-status-section">
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

        {native ? (
          // ─── Native iOS: variant selector ─────────────────────────────────
          <section className="space-y-3" data-testid="ai-model-variants-section">
            <h3 className="text-sm font-medium">
              {t.aiModel.variantSectionTitle}
            </h3>
            <div className="space-y-3">
              {NATIVE_VARIANTS.map((spec) => {
                const isActive = nativeVariant === spec.id;
                const isInstalledHere =
                  status.state === 'installed' && nativeVariant === spec.id;
                const isDownloadingHere =
                  status.state === 'downloading' && nativeVariant === spec.id;
                const labels =
                  spec.id === 'gemma-4-e2b'
                    ? {
                        name: t.aiModel.variantE2bName,
                        device: t.aiModel.variantE2bDevice,
                        quality: t.aiModel.variantE2bQuality,
                      }
                    : {
                        name: t.aiModel.variantE4bName,
                        device: t.aiModel.variantE4bDevice,
                        quality: t.aiModel.variantE4bQuality,
                      };
                return (
                  <div
                    key={spec.id}
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={0}
                    onClick={() => handleSelectVariant(spec.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectVariant(spec.id);
                      }
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg border p-4 transition-colors',
                      isActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50',
                    )}
                    data-testid={`ai-variant-card-${spec.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{labels.name}</p>
                          {isInstalledHere && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                              {t.aiModel.variantActive}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {labels.device}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {labels.quality}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                          <span>
                            {t.aiModel.variantDownloadSize(spec.sizeGb)}
                          </span>
                          <span>{t.aiModel.variantMinRam(spec.minRamGB)}</span>
                        </div>
                      </div>
                    </div>
                    {!isInstalledHere && !isDownloadingHere && (
                      <Button
                        className="mt-3 w-full"
                        variant={isActive ? 'default' : 'outline'}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectVariant(spec.id);
                        }}
                        disabled={
                          status.state === 'downloading' || ineligibility !== null
                        }
                        data-testid={`ai-variant-download-${spec.id}`}
                      >
                        {t.aiModel.download}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t.aiModel.variantRequiresPaidDev}
            </p>
          </section>
        ) : (
          // ─── Desktop: single Qwen3.5 model, original UX ────────────────────
          <section className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t.aiModel.approxSize}</span>
              <span>{t.aiModel.wifiRecommended}</span>
            </div>
            {status.state !== 'installed' && (
              <Button
                className="w-full"
                onClick={() => handleDownload()}
                disabled={status.state === 'downloading' || ineligibility !== null}
                data-testid="ai-model-download-button"
              >
                {status.state === 'error' ? t.aiModel.retry : t.aiModel.download}
              </Button>
            )}
          </section>
        )}

        {(status.state === 'installed' ||
          status.state === 'downloading' ||
          status.state === 'error') && (
          <section>
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
          </section>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">
          {native ? t.aiModel.nativePoweredBy : t.aiModel.poweredBy}
        </p>
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

      <ConfirmDialog
        open={confirmSwitchVariant !== null}
        title={t.aiModel.variantSectionTitle}
        description={t.aiModel.variantSwitchConfirm}
        confirmLabel={t.aiModel.download}
        cancelLabel={t.aiModel.cancel}
        destructive
        onConfirm={confirmSwitchAndDownload}
        onCancel={() => setConfirmSwitchVariant(null)}
      />
    </>
  );
}
