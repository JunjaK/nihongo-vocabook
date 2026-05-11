import {
  createDownloadResumable,
  type DownloadProgressData,
  type DownloadResumable,
  type DownloadPauseState,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
} from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

/**
 * On-device model manager (iOS-native path) — owns download / cancel / delete
 * for LiteRT-LM Gemma 4 model files. Mirrors the API shape of
 * `apps/web/src/lib/ai/model-manager.ts` so the bridge layer can sink status
 * updates into the existing web UI without translation.
 *
 * Variants: we support Gemma 4 E2B (2.58 GB, 4 GB RAM min) and E4B (3.41 GB,
 * 6 GB RAM min). Only one variant can be installed at a time — switching
 * deletes the old file before starting the new download. The user picks the
 * variant from the web settings page; the native side never decides on its
 * own which one to download.
 *
 * State persistence: SecureStore key `nivoca-ai-meta` holds the installed
 * variantId + file path. The in-flight `DownloadResumable.savable()` is
 * persisted to `nivoca-ai-resume` so a process kill mid-download can resume
 * on next launch without re-fetching the whole 2-3 GB.
 */

// Must match `apps/mobile/modules/nivoca-ai/src/NivocaAi.types.ts`.
export type ModelStatusState =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'error';

export type ModelVariantId = 'gemma-4-e2b' | 'gemma-4-e4b';

export interface ModelVariant {
  id: ModelVariantId;
  /** Display name, English (i18n on the web side). */
  name: string;
  url: string;
  /** Filename under `Documents/ai-models/`. */
  filename: string;
  /** Expected exact byte count from HF Content-Length. */
  sizeBytes: number;
  /** Minimum device RAM in gigabytes (advisory). */
  minRamGB: number;
  /** Marketing-style minimum recommended device. */
  recommendedDevice: string;
  /**
   * `> 2 GB` models need
   * `com.apple.developer.kernel.extended-virtual-addressing` on iOS — paid
   * Apple Developer account only. Personal Team builds will hit
   * `engine_create_failed` in ~0.1s.
   */
  requiresExtendedAddressing: boolean;
}

export const MODEL_VARIANTS: readonly ModelVariant[] = [
  {
    id: 'gemma-4-e2b',
    name: 'Gemma 4 E2B',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm',
    filename: 'gemma-4-E2B-it.litertlm',
    sizeBytes: 2_588_147_712,
    minRamGB: 4,
    recommendedDevice: 'iPhone 13 or later',
    requiresExtendedAddressing: true,
  },
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
    filename: 'gemma-4-E4B-it.litertlm',
    sizeBytes: 3_659_530_240,
    minRamGB: 6,
    recommendedDevice: 'iPhone 15 Pro or later',
    requiresExtendedAddressing: true,
  },
];

export const DEFAULT_VARIANT_ID: ModelVariantId = 'gemma-4-e2b';

export interface ModelStatus {
  state: ModelStatusState;
  /** Which variant the current state refers to. Always set, even for `not_installed`. */
  variantId: ModelVariantId;
  /** 0..1 — present only while `state === 'downloading'`. */
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

const MODEL_SUBDIR = 'ai-models';
const META_KEY = 'nivoca-ai-meta';
const RESUME_KEY = 'nivoca-ai-resume';
const SELECTED_VARIANT_KEY = 'nivoca-ai-selected-variant';

/** Throttle download progress callbacks to ≤1 Hz. */
const PROGRESS_THROTTLE_MS = 1000;

interface PersistedMeta {
  installed: boolean;
  variantId: ModelVariantId;
  path: string;
}

type Listener = (status: ModelStatus) => void;

function findVariant(id: ModelVariantId | string): ModelVariant {
  const v = MODEL_VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown variant: ${id}`);
  return v;
}

function pathFor(variant: ModelVariant): string {
  return `${documentDirectory}${MODEL_SUBDIR}/${variant.filename}`;
}

class ModelManager {
  private status: ModelStatus = {
    state: 'not_installed',
    variantId: DEFAULT_VARIANT_ID,
  };
  private listeners = new Set<Listener>();
  private resumable: DownloadResumable | null = null;
  private downloadingVariant: ModelVariant | null = null;
  private lastEmitAt = 0;
  private pendingEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStatus: ModelStatus | null = null;
  private bootPromise: Promise<void> | null = null;

  getStatus(): ModelStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolve persisted state on first call. Idempotent — repeat calls await the
   * same boot promise so the bridge layer can call this from multiple entry
   * points without racing.
   *
   * Boot strategy: the file on disk is the source of truth. SecureStore is
   * only a hint about *which* variant was installed last; we cross-check by
   * actually probing each variant's expected path. Dev builds re-sign with
   * slightly different keychain access groups between runs and that wipes
   * SecureStore even when the multi-GB file is still in Documents/.
   */
  async ensureBooted(): Promise<void> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  private async boot(): Promise<void> {
    try {
      // Determine "selected variant" — preference, not an installed flag.
      const selectedRaw = await SecureStore.getItemAsync(
        SELECTED_VARIANT_KEY,
      ).catch(() => null);
      const selectedVariantId: ModelVariantId =
        selectedRaw && MODEL_VARIANTS.some((v) => v.id === selectedRaw)
          ? (selectedRaw as ModelVariantId)
          : DEFAULT_VARIANT_ID;

      // Probe both variants on disk. If any is installed, that wins —
      // single-variant-at-a-time policy means at most one will be present.
      for (const variant of MODEL_VARIANTS) {
        const info = await getInfoAsync(pathFor(variant));
        if (info.exists) {
          const meta: PersistedMeta = {
            installed: true,
            variantId: variant.id,
            path: pathFor(variant),
          };
          await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta)).catch(
            () => undefined,
          );
          await SecureStore.setItemAsync(
            SELECTED_VARIANT_KEY,
            variant.id,
          ).catch(() => undefined);
          this.setStatus({ state: 'installed', variantId: variant.id });
          return;
        }
      }

      // Nothing installed — clear stale meta and report on the preferred
      // (selected) variant so the UI can show the right "Download" button.
      await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
      this.setStatus({
        state: 'not_installed',
        variantId: selectedVariantId,
      });
    } catch {
      await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    }
  }

  /** Persist the user's variant preference. Does not start a download. */
  async setSelectedVariant(variantId: ModelVariantId): Promise<void> {
    findVariant(variantId);
    await SecureStore.setItemAsync(SELECTED_VARIANT_KEY, variantId).catch(
      () => undefined,
    );
    // Don't overwrite an "installed" / "downloading" status — those refer to
    // an actual file in flight or on disk. Only update the visible
    // `variantId` when we're in `not_installed`.
    if (this.status.state === 'not_installed') {
      this.setStatus({ state: 'not_installed', variantId });
    }
  }

  async startDownload(variantId?: ModelVariantId): Promise<void> {
    if (this.status.state === 'downloading') return;

    const targetId = variantId ?? this.status.variantId;
    const target = findVariant(targetId);

    // Switching variants: wipe whatever else is installed first. Disk on
    // iPhones is precious; we don't keep both 2.5 GB + 3.4 GB blobs around.
    if (this.status.state === 'installed' && this.status.variantId !== targetId) {
      await this.purgeAllVariantFiles().catch(() => undefined);
    } else if (this.status.state === 'installed') {
      // Already installed and matches the requested variant — nothing to do.
      return;
    }

    await SecureStore.setItemAsync(SELECTED_VARIANT_KEY, target.id).catch(
      () => undefined,
    );
    this.downloadingVariant = target;
    this.setStatus({
      state: 'downloading',
      variantId: target.id,
      progress: 0,
    });

    try {
      await this.ensureModelDirectory();

      const resumeJson = await SecureStore.getItemAsync(RESUME_KEY);
      const resumeData = resumeJson
        ? (JSON.parse(resumeJson) as DownloadPauseState & {
            variantId?: ModelVariantId;
          })
        : null;
      // Discard resume data if it's for a different variant.
      const usableResume =
        resumeData && resumeData.variantId === target.id ? resumeData : null;

      this.resumable = createDownloadResumable(
        usableResume?.url ?? target.url,
        usableResume?.fileUri ?? pathFor(target),
        usableResume?.options,
        this.handleProgress,
        usableResume?.resumeData,
      );

      const result = await this.resumable.downloadAsync();
      this.resumable = null;
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);

      // `downloadAsync()` resolves with `undefined` when the task was canceled.
      if (!result) {
        this.downloadingVariant = null;
        return;
      }

      await this.markInstalled(target, result.uri);
    } catch (err) {
      this.resumable = null;
      this.downloadingVariant = null;
      const message = err instanceof Error ? err.message : 'download_failed';
      this.setStatus({ state: 'error', variantId: target.id, message });
    }
  }

  async cancelDownload(): Promise<void> {
    const current = this.downloadingVariant ?? findVariant(this.status.variantId);
    if (!this.resumable) {
      await this.removeFile(current).catch(() => undefined);
      this.downloadingVariant = null;
      this.setStatus({ state: 'not_installed', variantId: current.id });
      return;
    }
    try {
      const pause = await this.resumable.pauseAsync().catch(() => null);
      if (pause) {
        // User asked to cancel — deliberately do NOT persist resume data.
        void pause;
      }
    } finally {
      this.resumable = null;
    }
    await this.removeFile(current).catch(() => undefined);
    await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    this.flushPendingEmit();
    this.downloadingVariant = null;
    this.setStatus({ state: 'not_installed', variantId: current.id });
  }

  async deleteModel(): Promise<void> {
    if (this.resumable) {
      await this.cancelDownload();
      return;
    }
    const current = findVariant(this.status.variantId);
    await this.purgeAllVariantFiles().catch(() => undefined);
    await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    this.setStatus({ state: 'not_installed', variantId: current.id });
  }

  // ---------------------------------------------------------------------------

  private async ensureModelDirectory(): Promise<void> {
    const dir = `${documentDirectory}${MODEL_SUBDIR}`;
    const info = await getInfoAsync(dir);
    if (!info.exists) {
      await makeDirectoryAsync(dir, { intermediates: true });
    }
  }

  private async removeFile(variant: ModelVariant): Promise<void> {
    const path = pathFor(variant);
    const info = await getInfoAsync(path);
    if (info.exists) {
      await deleteAsync(path, { idempotent: true });
    }
  }

  /** Wipe every known variant file. Used when switching variants. */
  private async purgeAllVariantFiles(): Promise<void> {
    for (const variant of MODEL_VARIANTS) {
      await this.removeFile(variant).catch(() => undefined);
    }
  }

  private async markInstalled(
    variant: ModelVariant,
    uri: string,
  ): Promise<void> {
    // TODO(phase-d): expo-file-system v55 dropped
    // `setIsExcludedFromBackupAsync`. To keep the 2.5–3.4 GB blob out of
    // iCloud backup we'll add a native Swift call from the `nivoca-ai`
    // module (`NSURL.setResourceValue(true, forKey: .isExcludedFromBackupKey)`).
    const meta: PersistedMeta = {
      installed: true,
      variantId: variant.id,
      path: uri,
    };
    await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta));
    await SecureStore.setItemAsync(SELECTED_VARIANT_KEY, variant.id);
    this.flushPendingEmit();
    this.downloadingVariant = null;
    this.setStatus({ state: 'installed', variantId: variant.id });
  }

  private handleProgress = (data: DownloadProgressData) => {
    const total = data.totalBytesExpectedToWrite || 0;
    const loaded = data.totalBytesWritten || 0;
    const progress = total > 0 ? Math.min(1, loaded / total) : 0;
    const variant = this.downloadingVariant;
    if (!variant) return;
    const next: ModelStatus = {
      state: 'downloading',
      variantId: variant.id,
      progress,
      loadedBytes: loaded,
      totalBytes: total || undefined,
    };
    this.scheduleEmit(next);
  };

  /** Trailing-edge 1 Hz throttle — same pattern as `gemma-web.ts:149-202`. */
  private scheduleEmit(status: ModelStatus) {
    this.pendingStatus = status;
    const now = Date.now();
    const delta = now - this.lastEmitAt;
    if (delta >= PROGRESS_THROTTLE_MS) {
      this.flushPendingEmit();
    } else if (this.pendingEmitTimer === null) {
      this.pendingEmitTimer = setTimeout(
        () => this.flushPendingEmit(),
        PROGRESS_THROTTLE_MS - delta,
      );
    }
  }

  private flushPendingEmit() {
    if (this.pendingEmitTimer !== null) {
      clearTimeout(this.pendingEmitTimer);
      this.pendingEmitTimer = null;
    }
    if (this.pendingStatus) {
      this.setStatus(this.pendingStatus);
      this.pendingStatus = null;
      this.lastEmitAt = Date.now();
    }
  }

  private setStatus(next: ModelStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }
}

export const modelManager = new ModelManager();
