import {
  createDownloadResumable,
  type DownloadProgressData,
  type DownloadResumable,
  type DownloadPauseState,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

import type { AiModelStatusSnapshot } from '../../types/bridge';

/**
 * On-device model manager (iOS-native path) — owns download / cancel / delete
 * for LiteRT-LM Gemma 4 model files. Multi-variant: both Gemma 4 E2B
 * (2.58 GB, 4 GB RAM min) and E4B (3.41 GB, 6 GB RAM min) can coexist on
 * disk. Sequential download policy — only one download in flight at any
 * time so the user (and iOS Jetsam) doesn't get clobbered by parallel
 * 2-3 GB streams.
 *
 * Active variant — when both variants are installed, exactly one is the
 * "active" one used for inference. The Swift side reads
 * `ai-models/active.txt` to know which `.litertlm` file to load.
 *
 * State persistence:
 *   - On-disk file existence is the source of truth for "installed".
 *   - SecureStore key `nivoca-ai-active` holds the active variantId.
 *   - SecureStore key `nivoca-ai-resume` persists the in-flight
 *     `DownloadResumable.savable()` (so a process kill mid-download can
 *     resume on next launch without re-fetching the multi-GB blob).
 *   - `ai-models/active.txt` (plaintext, one variant id) is the file
 *     Swift reads — kept in sync with `nivoca-ai-active`.
 */

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
  },
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
    filename: 'gemma-4-E4B-it.litertlm',
    sizeBytes: 3_659_530_240,
    minRamGB: 6,
    recommendedDevice: 'iPhone 15 Pro or later',
  },
];

const MODEL_SUBDIR = 'ai-models';
const ACTIVE_KEY = 'nivoca-ai-active';
const RESUME_KEY = 'nivoca-ai-resume';
const ACTIVE_FILENAME = 'active.txt';

/** Throttle download progress callbacks to ≤1 Hz. */
const PROGRESS_THROTTLE_MS = 1000;

type Listener = (snapshot: AiModelStatusSnapshot) => void;

function findVariant(id: ModelVariantId): ModelVariant {
  const v = MODEL_VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown variant: ${id}`);
  return v;
}

function pathFor(variant: ModelVariant): string {
  return `${documentDirectory}${MODEL_SUBDIR}/${variant.filename}`;
}

function activeFilePath(): string {
  return `${documentDirectory}${MODEL_SUBDIR}/${ACTIVE_FILENAME}`;
}

interface ResumeMeta extends DownloadPauseState {
  variantId: ModelVariantId;
}

class ModelManager {
  private snapshot: AiModelStatusSnapshot = {
    installed: [],
    active: null,
    downloading: null,
    error: null,
  };
  private listeners = new Set<Listener>();
  private resumable: DownloadResumable | null = null;
  private downloadingVariant: ModelVariant | null = null;
  private lastEmitAt = 0;
  private pendingEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSnapshot: AiModelStatusSnapshot | null = null;
  private bootPromise: Promise<void> | null = null;

  getSnapshot(): AiModelStatusSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolve persisted state on first call. Idempotent — repeat calls await
   * the same boot promise so the bridge layer can call this from multiple
   * entry points without racing.
   *
   * Probe both variants on disk. If exactly one is present, auto-activate it.
   * If both are present, fall back to the persisted active variant; if that
   * is missing or invalid, default to whichever was probed first
   * (canonical MODEL_VARIANTS order, E2B before E4B).
   */
  async ensureBooted(): Promise<void> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  private async boot(): Promise<void> {
    try {
      await this.ensureModelDirectory();
      const installed: ModelVariantId[] = [];
      for (const variant of MODEL_VARIANTS) {
        const info = await getInfoAsync(pathFor(variant));
        if (info.exists) installed.push(variant.id);
      }

      const persistedActive = (await SecureStore.getItemAsync(ACTIVE_KEY).catch(
        () => null,
      )) as ModelVariantId | null;
      let active: ModelVariantId | null = null;
      if (persistedActive && installed.includes(persistedActive)) {
        active = persistedActive;
      } else if (installed.length > 0) {
        // First installed variant wins. Persist so subsequent boots are stable.
        active = installed[0];
        await this.persistActive(active);
      } else {
        // No model installed yet — clear any stale active marker.
        await SecureStore.deleteItemAsync(ACTIVE_KEY).catch(() => undefined);
      }

      this.setSnapshot({
        installed,
        active,
        downloading: null,
        error: null,
      });
    } catch {
      // Boot is best-effort; on failure leave the default empty snapshot so
      // the UI can still render and the user can retry from settings.
    }
  }

  async setActive(variantId: ModelVariantId): Promise<void> {
    findVariant(variantId);
    if (!this.snapshot.installed.includes(variantId)) {
      // Activating a non-installed variant is a no-op — UI shouldn't even
      // expose the option, but guard the API surface anyway.
      return;
    }
    if (this.snapshot.active === variantId) return;
    await this.persistActive(variantId);
    this.setSnapshot({ ...this.snapshot, active: variantId });
  }

  async startDownload(variantId: ModelVariantId): Promise<void> {
    if (this.snapshot.downloading) {
      // Sequential policy — refuse to start a second download while one is
      // in flight. UI keeps the other variant's button disabled.
      return;
    }
    const target = findVariant(variantId);
    if (this.snapshot.installed.includes(variantId)) {
      // Already on disk — just make sure it's active (matches the
      // "select" semantics in the UI button).
      await this.setActive(variantId);
      return;
    }

    this.downloadingVariant = target;
    this.setSnapshot({
      ...this.snapshot,
      downloading: { variantId, progress: 0 },
      error: null,
    });

    try {
      await this.ensureModelDirectory();

      const resumeJson = await SecureStore.getItemAsync(RESUME_KEY);
      const resumeData = resumeJson
        ? (JSON.parse(resumeJson) as ResumeMeta)
        : null;
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

      if (!result) {
        // Cancelled — `cancelDownload` already cleaned up state.
        this.downloadingVariant = null;
        return;
      }

      await this.markInstalled(target);
    } catch (err) {
      this.resumable = null;
      this.downloadingVariant = null;
      const message = err instanceof Error ? err.message : 'download_failed';
      this.flushPendingEmit();
      this.setSnapshot({
        ...this.snapshot,
        downloading: null,
        error: { variantId: target.id, message },
      });
    }
  }

  async cancelDownload(): Promise<void> {
    const dl = this.snapshot.downloading;
    if (!dl) return;
    const variant = findVariant(dl.variantId);
    if (this.resumable) {
      try {
        await this.resumable.pauseAsync().catch(() => null);
      } finally {
        this.resumable = null;
      }
    }
    await this.removeFile(variant).catch(() => undefined);
    await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    this.flushPendingEmit();
    this.downloadingVariant = null;
    this.setSnapshot({
      ...this.snapshot,
      downloading: null,
      error: null,
    });
  }

  async deleteVariant(variantId: ModelVariantId): Promise<void> {
    const variant = findVariant(variantId);
    // If the user hits "Cancel" on the in-flight variant we route to
    // cancelDownload — semantics match the UI label swap.
    if (this.snapshot.downloading?.variantId === variantId) {
      await this.cancelDownload();
      return;
    }
    await this.removeFile(variant).catch(() => undefined);
    const installed = this.snapshot.installed.filter((id) => id !== variantId);
    let active = this.snapshot.active;
    if (active === variantId) {
      active = installed[0] ?? null;
      if (active) {
        await this.persistActive(active);
      } else {
        await SecureStore.deleteItemAsync(ACTIVE_KEY).catch(() => undefined);
        await this.removeActiveFile().catch(() => undefined);
      }
    }
    this.setSnapshot({
      ...this.snapshot,
      installed,
      active,
      error: null,
    });
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

  private async removeActiveFile(): Promise<void> {
    const info = await getInfoAsync(activeFilePath());
    if (info.exists) {
      await deleteAsync(activeFilePath(), { idempotent: true });
    }
  }

  /** Persist the user's active-variant choice to both SecureStore (for the
   *  TS side) and `ai-models/active.txt` (for Swift to read at load time). */
  private async persistActive(variantId: ModelVariantId): Promise<void> {
    await SecureStore.setItemAsync(ACTIVE_KEY, variantId).catch(() => undefined);
    await this.ensureModelDirectory();
    await writeAsStringAsync(activeFilePath(), variantId).catch(() => undefined);
  }

  private async markInstalled(variant: ModelVariant): Promise<void> {
    this.flushPendingEmit();
    this.downloadingVariant = null;
    const installed = this.snapshot.installed.includes(variant.id)
      ? this.snapshot.installed
      : [...this.snapshot.installed, variant.id];
    // Auto-activate when this is the first installed variant; otherwise
    // leave the existing active selection alone so a user finishing the
    // second download doesn't lose their preferred model.
    const active =
      this.snapshot.active === null ? variant.id : this.snapshot.active;
    if (active === variant.id) {
      await this.persistActive(variant.id);
    }
    this.setSnapshot({
      installed,
      active,
      downloading: null,
      error: null,
    });
  }

  private handleProgress = (data: DownloadProgressData) => {
    const total = data.totalBytesExpectedToWrite || 0;
    const loaded = data.totalBytesWritten || 0;
    const progress = total > 0 ? Math.min(1, loaded / total) : 0;
    const variant = this.downloadingVariant;
    if (!variant) return;
    const next: AiModelStatusSnapshot = {
      ...this.snapshot,
      downloading: {
        variantId: variant.id,
        progress,
        loadedBytes: loaded,
        totalBytes: total || undefined,
      },
    };
    this.scheduleEmit(next);
  };

  /** Trailing-edge 1 Hz throttle — same pattern as the prior single-variant
   *  manager so the JS<->WebView bridge doesn't get flooded. */
  private scheduleEmit(snapshot: AiModelStatusSnapshot) {
    this.pendingSnapshot = snapshot;
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
    if (this.pendingSnapshot) {
      this.setSnapshot(this.pendingSnapshot);
      this.pendingSnapshot = null;
      this.lastEmitAt = Date.now();
    }
  }

  private setSnapshot(next: AiModelStatusSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
}

export const modelManager = new ModelManager();
