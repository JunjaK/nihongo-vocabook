/**
 * IndexedDB blob storage for chat image attachments.
 *
 * Uses the native IndexedDB API (no Dexie dep — the project removed Dexie
 * alongside the guest repo simplification). 500 MB soft cap with 14-day LRU
 * pruning. Binary blobs are local-device only — `attachment_ids` in
 * Supabase ai_messages are placeholders so cross-device hydrate can render
 * `[image]` text.
 */

/**
 * Read a `Blob` as a `data:<mime>;base64,...` URL. Used when the chat needs
 * to ship an attachment across the native bridge — Object URLs (`blob:`) are
 * renderer-only.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

// Shared DB with metrics.ts — both modules must agree on DB_VERSION and run
// each store's `onupgradeneeded` branch defensively.
const DB_NAME = 'nivoca-chat';
const DB_VERSION = 2;
const STORE = 'attachments';

const STORAGE_CAP_BYTES = 500 * 1024 * 1024;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AttachmentRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
  byteSize: number;
  createdAt: number;
  lastAccessedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable in this environment'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Defensive: create both stores if missing, since attachments and
      // metrics share this DB and either may trigger the upgrade.
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('lastAccessedAt', 'lastAccessedAt');
        store.createIndex('byteSize', 'byteSize');
      }
      if (!db.objectStoreNames.contains('metrics')) {
        const m = db.createObjectStore('metrics', { keyPath: 'id', autoIncrement: true });
        m.createIndex('event', 'event');
        m.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result: T | undefined;
        const req = fn(store);
        if (req) {
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error);
        }
        tx.oncomplete = () => resolve(result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
      }),
  );
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function storeAttachment(
  blob: Blob,
  meta: { mimeType: string; width?: number; height?: number },
): Promise<string> {
  const id = randomId();
  const record: AttachmentRecord = {
    id,
    blob,
    mimeType: meta.mimeType,
    width: meta.width,
    height: meta.height,
    byteSize: blob.size,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
  await runTx('readwrite', (store) => store.add(record));
  // Best-effort cap enforcement (don't fail the write on prune error).
  pruneAttachments().catch(() => {});
  return id;
}

export async function getAttachment(id: string): Promise<Blob | null> {
  const record = (await runTx<AttachmentRecord | undefined>('readonly', (store) =>
    store.get(id) as IDBRequest<AttachmentRecord | undefined>,
  )) as AttachmentRecord | undefined;
  if (!record) return null;
  // Bump lastAccessedAt asynchronously — don't block the read.
  runTx('readwrite', (store) => {
    record.lastAccessedAt = Date.now();
    store.put(record);
  }).catch(() => {});
  return record.blob;
}

export async function getAttachmentPreviewUrl(id: string): Promise<string | null> {
  const blob = await getAttachment(id);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function deleteAttachment(id: string): Promise<void> {
  await runTx('readwrite', (store) => store.delete(id));
}

/**
 * Two-pass prune:
 *  1. Remove every record where `createdAt < now - TTL_MS`.
 *  2. If total bytes still > cap, remove oldest-by-lastAccessedAt until under cap.
 *
 * Idempotent and safe to call frequently. Returns the freed byte count.
 */
export async function pruneAttachments(): Promise<{
  freedBytes: number;
  removedCount: number;
}> {
  const cutoff = Date.now() - TTL_MS;
  const all = await runTx<AttachmentRecord[]>('readonly', (store) => {
    return store.getAll() as IDBRequest<AttachmentRecord[]>;
  });
  if (!all || all.length === 0) return { freedBytes: 0, removedCount: 0 };

  let removed = 0;
  let freed = 0;
  const toDelete: string[] = [];

  // Pass 1 — TTL
  const keep: AttachmentRecord[] = [];
  for (const rec of all) {
    if (rec.createdAt < cutoff) {
      toDelete.push(rec.id);
      removed++;
      freed += rec.byteSize;
    } else {
      keep.push(rec);
    }
  }

  // Pass 2 — cap (LRU on lastAccessedAt)
  let totalKeep = keep.reduce((acc, r) => acc + r.byteSize, 0);
  if (totalKeep > STORAGE_CAP_BYTES) {
    keep.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const rec of keep) {
      if (totalKeep <= STORAGE_CAP_BYTES) break;
      toDelete.push(rec.id);
      removed++;
      freed += rec.byteSize;
      totalKeep -= rec.byteSize;
    }
  }

  if (toDelete.length > 0) {
    await runTx('readwrite', (store) => {
      for (const id of toDelete) store.delete(id);
    });
  }

  return { freedBytes: freed, removedCount: removed };
}
