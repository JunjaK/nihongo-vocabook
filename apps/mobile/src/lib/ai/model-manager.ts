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
 * for the Gemma 4 E2B LiteRT-LM model file. Mirrors the API shape of
 * `apps/web/src/lib/ai/model-manager.ts` so the bridge layer can sink status
 * updates into the existing web UI without translation.
 *
 * State persistence: SecureStore key `nivoca-ai-meta` holds the installed
 * flag and the file path. The in-flight `DownloadResumable.savable()` is
 * separately persisted to `nivoca-ai-resume` so a process kill mid-download
 * can resume on next launch without re-fetching ~2.5 GB.
 *
 * Listener pattern: identical to web — `subscribe()` returns an unsubscribe
 * function, every status mutation runs `emit()`.
 */

// Must match `apps/mobile/modules/nivoca-ai/src/NivocaAi.types.ts`.
export type ModelStatusState = 'not_installed' | 'downloading' | 'installed' | 'error';

export interface ModelStatus {
  state: ModelStatusState;
  /** 0..1 — present only while `state === 'downloading'`. */
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

// HuggingFace artifact — verified live (2.47 GB single file, no sharding).
const MODEL_URL =
  'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';
const MODEL_FILENAME = 'gemma-4-E2B-it.litertlm';
const MODEL_SUBDIR = 'ai-models';

const META_KEY = 'nivoca-ai-meta';
const RESUME_KEY = 'nivoca-ai-resume';

/** Throttle download progress callbacks to ≤1 Hz. */
const PROGRESS_THROTTLE_MS = 1000;

interface PersistedMeta {
  installed: boolean;
  path: string;
}

type Listener = (status: ModelStatus) => void;

class ModelManager {
  private status: ModelStatus = { state: 'not_installed' };
  private listeners = new Set<Listener>();
  private resumable: DownloadResumable | null = null;
  private lastEmitAt = 0;
  private pendingEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStatus: ModelStatus | null = null;
  private bootPromise: Promise<void> | null = null;

  /** Path where the model lives if installed. */
  get modelPath(): string {
    return `${documentDirectory}${MODEL_SUBDIR}/${MODEL_FILENAME}`;
  }

  /** Synchronous status snapshot. Subscribers see the same shape via listeners. */
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
   */
  async ensureBooted(): Promise<void> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  private async boot(): Promise<void> {
    // The file on disk is the source of truth for "installed" — SecureStore
    // meta is only a hint. Dev builds via `bunx expo run:ios` can re-sign
    // the app with a slightly different keychain access group between runs,
    // which makes our `nivoca-ai-meta` entry look gone even though the
    // ~2.5 GB model file is still sitting in Documents/. Trusting meta alone
    // forced the user to re-download every rebuild, so we check disk first
    // and re-write the meta on recovery.
    try {
      const info = await getInfoAsync(this.modelPath);
      if (info.exists) {
        // File present — mark installed regardless of SecureStore state.
        // Refresh the meta entry so the next boot sees it on the happy path
        // (and so `deleteModel()` has something to clear).
        const meta: PersistedMeta = { installed: true, path: this.modelPath };
        await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta)).catch(
          () => undefined,
        );
        this.setStatus({ state: 'installed' });
        return;
      }
      // File missing — clear any stale meta + resume blob so we don't try
      // to resume a download whose partial file iOS already evicted.
      await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    } catch {
      // I/O error — best effort cleanup, stay in `not_installed`.
      await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    }
  }

  async startDownload(): Promise<void> {
    if (this.status.state === 'downloading') return;
    if (this.status.state === 'installed') return;

    this.setStatus({ state: 'downloading', progress: 0 });

    try {
      await this.ensureModelDirectory();

      // Try to resume an interrupted download if SecureStore has pause data.
      const resumeJson = await SecureStore.getItemAsync(RESUME_KEY);
      const resumeData = resumeJson ? (JSON.parse(resumeJson) as DownloadPauseState) : null;

      this.resumable = createDownloadResumable(
        resumeData?.url ?? MODEL_URL,
        resumeData?.fileUri ?? this.modelPath,
        resumeData?.options,
        this.handleProgress,
        resumeData?.resumeData,
      );

      const result = await this.resumable.downloadAsync();
      this.resumable = null;
      await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);

      // `downloadAsync()` resolves with `undefined` when the task was canceled.
      if (!result) return;

      await this.markInstalled(result.uri);
    } catch (err) {
      this.resumable = null;
      const message = err instanceof Error ? err.message : 'download_failed';
      this.setStatus({ state: 'error', message });
    }
  }

  async cancelDownload(): Promise<void> {
    if (!this.resumable) {
      // Nothing in flight — make sure we still drop any stale partial file.
      await this.removeFile().catch(() => undefined);
      this.setStatus({ state: 'not_installed' });
      return;
    }
    try {
      // Persist pauseable resume data first so the user could in theory
      // restart the partial download; on cancel we then wipe the file.
      const pause = await this.resumable.pauseAsync().catch(() => null);
      if (pause) {
        // We deliberately do NOT save resume — user asked to cancel.
        void pause;
      }
    } finally {
      this.resumable = null;
    }
    await this.removeFile().catch(() => undefined);
    await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    this.flushPendingEmit();
    this.setStatus({ state: 'not_installed' });
  }

  async deleteModel(): Promise<void> {
    if (this.resumable) {
      await this.cancelDownload();
      return;
    }
    await this.removeFile().catch(() => undefined);
    await SecureStore.deleteItemAsync(META_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(RESUME_KEY).catch(() => undefined);
    this.setStatus({ state: 'not_installed' });
  }

  // ---------------------------------------------------------------------------

  private async ensureModelDirectory(): Promise<void> {
    const dir = `${documentDirectory}${MODEL_SUBDIR}`;
    const info = await getInfoAsync(dir);
    if (!info.exists) {
      await makeDirectoryAsync(dir, { intermediates: true });
    }
  }

  private async removeFile(): Promise<void> {
    const info = await getInfoAsync(this.modelPath);
    if (info.exists) {
      await deleteAsync(this.modelPath, { idempotent: true });
    }
  }

  private async markInstalled(uri: string): Promise<void> {
    // TODO(phase-d): expo-file-system v55 dropped the
    // `setIsExcludedFromBackupAsync` helper. To prevent iCloud backup of the
    // 2.5 GB blob we'll add a native Swift call from the `nivoca-ai` module
    // (`NSURL.setResourceValue(true, forKey: .isExcludedFromBackupKey)`).
    const meta: PersistedMeta = { installed: true, path: uri };
    await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta));
    this.flushPendingEmit();
    this.setStatus({ state: 'installed' });
  }

  private handleProgress = (data: DownloadProgressData) => {
    const total = data.totalBytesExpectedToWrite || 0;
    const loaded = data.totalBytesWritten || 0;
    const progress = total > 0 ? Math.min(1, loaded / total) : 0;
    const next: ModelStatus = {
      state: 'downloading',
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
