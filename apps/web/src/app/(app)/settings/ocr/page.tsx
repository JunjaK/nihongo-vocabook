'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppOnlyGate } from '@/components/ai/app-only-gate';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { isNativeApp, type AiModelVariantId } from '@/lib/native-bridge';
import { getSnapshot, subscribeSnapshot } from '@/lib/ai/model-manager';
import {
  cancelNativeDownload,
  deleteNativeVariant,
  nativeIneligibilityKey,
  setNativeActiveVariant,
  triggerNativeDownload,
} from '@/lib/ai/native-bridge-adapter';
import { variantUiState } from '@/lib/ai/types';

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

export default function AiModelSettingsPage() {
  const { t } = useTranslation();
  const [snapshot, setSnapshotState] = useState(getSnapshot());
  const [confirmDeleteId, setConfirmDeleteId] =
    useState<AiModelVariantId | null>(null);
  const [ineligibility, setIneligibility] = useState<string | null>(null);
  // SSR-safe native detection — window-based check isn't safe at server render.
  const [native, setNative] = useState<boolean | null>(null);

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  useEffect(() => subscribeSnapshot(setSnapshotState), []);

  useEffect(() => {
    if (!native) return;
    // Mirror the native eligibility hint so we can disable the download
    // buttons when the device is too weak. Poll because the bridge fires
    // it lazily; cheap because the underlying value rarely changes.
    const tick = () => setIneligibility(nativeIneligibilityKey());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [native]);

  const localizeAiError = (message: string): string => {
    const table = t.aiModel as unknown as Record<string, string | undefined>;
    const localized = table[message];
    return typeof localized === 'string' ? localized : message;
  };

  const handleVariantAction = (variantId: AiModelVariantId) => {
    const ui = variantUiState(snapshot, variantId);
    if (ui.kind === 'not_installed') {
      // Sequential download policy — refuse if another variant is in flight.
      if (snapshot.downloading) {
        toast.info(t.aiModel.statusDownloading);
        return;
      }
      triggerNativeDownload(variantId);
      return;
    }
    if (ui.kind === 'installed_inactive') {
      setNativeActiveVariant(variantId);
      return;
    }
    if (ui.kind === 'error') {
      // Treat the user's tap as a retry: requeue the download. Native clears
      // the error when it transitions back to downloading.
      triggerNativeDownload(variantId);
    }
    // installed_active and downloading are handled by their own UI affordances
    // (disabled "selected" button / cancel button).
  };

  const handleDelete = (variantId: AiModelVariantId) => {
    const ui = variantUiState(snapshot, variantId);
    if (ui.kind === 'downloading') {
      cancelNativeDownload();
      return;
    }
    setConfirmDeleteId(variantId);
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    deleteNativeVariant(confirmDeleteId);
    setConfirmDeleteId(null);
    toast.success(t.aiModel.deleteSuccess);
  };

  // App-only feature — non-native runtimes see the install-the-app gate.
  if (native === null) return null;
  if (!native) {
    return <AppOnlyGate title={t.settings.aiModelPage} />;
  }

  const anyDownloading = snapshot.downloading !== null;

  return (
    <>
      <Header title={t.settings.aiModelPage} showBack />
      <div className="animate-page flex-1 space-y-6 overflow-y-auto px-5 pt-3 pb-6">
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t.aiModel.nativeTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.aiModel.description}
          </p>
        </section>

        <Separator />

        {ineligibility && (
          <p
            className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            data-testid="ai-model-eligibility-notice"
          >
            {localizeAiError(ineligibility)}
          </p>
        )}

        <section
          className="space-y-3"
          data-testid="ai-model-variants-section"
        >
          <h3 className="text-sm font-medium">
            {t.aiModel.variantSectionTitle}
          </h3>
          <div className="space-y-3">
            {NATIVE_VARIANTS.map((spec) => {
              const ui = variantUiState(snapshot, spec.id);
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
              const isActive = ui.kind === 'installed_active';
              const isInstalled =
                ui.kind === 'installed_active' || ui.kind === 'installed_inactive';
              const isDownloading = ui.kind === 'downloading';
              const isError = ui.kind === 'error';
              // Sequential policy: while one variant downloads, the other
              // can't start a new one. The disabled "Download" button is the
              // user's hint that they have to wait or cancel.
              const downloadDisabled =
                ineligibility !== null ||
                (anyDownloading && !isDownloading) ||
                isDownloading;

              return (
                <div
                  key={spec.id}
                  className={cn(
                    'rounded-lg border p-4 transition-colors',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border',
                  )}
                  data-testid={`ai-variant-card-${spec.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{labels.name}</p>
                        {isActive && (
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

                  {isDownloading && (
                    <div className="mt-3 space-y-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                          style={{ width: `${Math.round(ui.progress * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                        <span>
                          {ui.totalBytes
                            ? `${formatGB(ui.loadedBytes ?? 0)} / ${formatGB(ui.totalBytes)} GB`
                            : t.aiModel.statusDownloading}
                        </span>
                        <span>{Math.round(ui.progress * 100)}%</span>
                      </div>
                    </div>
                  )}

                  {isError && (
                    <p
                      className="mt-3 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                      data-testid={`ai-variant-error-${spec.id}`}
                    >
                      {localizeAiError(ui.message)}
                    </p>
                  )}

                  <div className="mt-3 flex gap-2">
                    {isActive ? (
                      <Button
                        className="flex-1"
                        variant="outline"
                        size="sm"
                        disabled
                        data-testid={`ai-variant-selected-${spec.id}`}
                      >
                        {t.aiModel.variantSelected}
                      </Button>
                    ) : (
                      <Button
                        className="flex-1"
                        variant={isInstalled ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleVariantAction(spec.id)}
                        disabled={
                          isInstalled
                            ? false
                            : isDownloading
                              ? true
                              : downloadDisabled
                        }
                        data-testid={`ai-variant-action-${spec.id}`}
                      >
                        {isInstalled
                          ? t.aiModel.variantSelectActive
                          : isError
                            ? t.aiModel.retry
                            : t.aiModel.download}
                      </Button>
                    )}
                    {(isInstalled || isDownloading) && (
                      <Button
                        className="flex-1"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(spec.id)}
                        data-testid={`ai-variant-delete-${spec.id}`}
                      >
                        {isDownloading
                          ? t.aiModel.cancelDownload
                          : t.aiModel.delete}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          {t.aiModel.nativePoweredBy}
        </p>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={t.aiModel.delete}
        description={t.aiModel.deleteConfirm}
        confirmLabel={t.aiModel.delete}
        cancelLabel={t.aiModel.cancel}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}
