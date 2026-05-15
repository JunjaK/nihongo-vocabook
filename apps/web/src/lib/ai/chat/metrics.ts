/**
 * Local-only AI metrics log. Writes events to IndexedDB for later retrieval
 * by the (Phase 1.5) `/settings/ai-stats` page. No external transmission.
 *
 * 90-day TTL, max 10,000 rows. Pruned opportunistically on each append.
 */

const DB_NAME = 'nivoca-chat';
const DB_VERSION = 2;
const STORE = 'metrics';

const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 10_000;

export interface AiMetric {
  id?: number;
  event: string;
  payload: Record<string, unknown>;
  timestamp: number;
  scope?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Defensive: create both stores if missing, since attachments and
      // metrics share this DB.
      if (!db.objectStoreNames.contains('attachments')) {
        const att = db.createObjectStore('attachments', { keyPath: 'id' });
        att.createIndex('createdAt', 'createdAt');
        att.createIndex('lastAccessedAt', 'lastAccessedAt');
        att.createIndex('byteSize', 'byteSize');
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const m = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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

let appendsSincePrune = 0;
const PRUNE_EVERY = 100;

/**
 * Whitelist of events that also get uploaded as anonymous telemetry when the
 * user opts in. Everything else stays local-only. Payload shape for these
 * events is already counter/enum (no free-form strings).
 */
const TELEMETRY_EVENTS = new Set([
  'chat.message_sent',
  'chat.inference_start',
  'chat.inference_done',
  'chat.inference_error',
  'chat.cancelled_by_user',
  'chat.tool_call_executed',
  'chat.tool_call_failed',
  'chat.context_truncated',
]);

export async function recordMetric(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const scope =
    typeof payload.scope === 'string' ? (payload.scope as string) : undefined;
  const metric: AiMetric = {
    event,
    payload,
    timestamp: Date.now(),
    scope,
  };
  try {
    await runTx('readwrite', (store) => store.add(metric));
  } catch {
    // Silent — metric loss is acceptable, don't crash the caller.
    return;
  }
  appendsSincePrune++;
  if (appendsSincePrune >= PRUNE_EVERY) {
    appendsSincePrune = 0;
    pruneMetrics().catch(() => {});
  }

  // Mirror to opt-in telemetry. Dynamic import so this module stays
  // independent of the uploader (avoids a circular dependency).
  if (TELEMETRY_EVENTS.has(event)) {
    void import('./telemetry-uploader').then((m) => {
      m.recordTelemetry(
        event,
        coerceCounters(payload),
        (scope as 'general' | 'word' | 'wordbook' | 'quiz' | undefined) ?? undefined,
      );
    });
  }
}

/**
 * Shrink `payload` to counter-safe primitive values. The repository-level
 * `scrubPayload` is the final safety net — this is the first pass.
 */
function coerceCounters(
  payload: Record<string, unknown>,
): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'string' && v.length <= 64) out[k] = v;
  }
  return out;
}

export async function listMetrics(opts?: {
  event?: string;
  sinceTimestamp?: number;
  limit?: number;
}): Promise<AiMetric[]> {
  const all = await runTx<AiMetric[]>('readonly', (store) => {
    return store.getAll() as IDBRequest<AiMetric[]>;
  });
  if (!all) return [];
  let rows = all;
  if (opts?.event) rows = rows.filter((m) => m.event === opts.event);
  if (opts?.sinceTimestamp) {
    rows = rows.filter((m) => m.timestamp >= opts.sinceTimestamp!);
  }
  rows.sort((a, b) => b.timestamp - a.timestamp);
  if (opts?.limit) rows = rows.slice(0, opts.limit);
  return rows;
}

export async function pruneMetrics(): Promise<{ removedCount: number }> {
  const cutoff = Date.now() - TTL_MS;
  const all = await runTx<AiMetric[]>('readonly', (store) => {
    return store.getAll() as IDBRequest<AiMetric[]>;
  });
  if (!all || all.length === 0) return { removedCount: 0 };

  const toRemove: number[] = [];
  for (const m of all) {
    if (m.timestamp < cutoff && m.id !== undefined) {
      toRemove.push(m.id);
    }
  }

  // Cap pass — keep most recent MAX_ROWS only.
  if (all.length - toRemove.length > MAX_ROWS) {
    const remaining = all
      .filter((m) => m.id !== undefined && !toRemove.includes(m.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    const excess = remaining.length - MAX_ROWS;
    for (let i = 0; i < excess; i++) {
      const id = remaining[i].id;
      if (id !== undefined) toRemove.push(id);
    }
  }

  if (toRemove.length > 0) {
    await runTx('readwrite', (store) => {
      for (const id of toRemove) store.delete(id);
    });
  }
  return { removedCount: toRemove.length };
}

export async function clearAllMetrics(): Promise<void> {
  await runTx('readwrite', (store) => store.clear());
}
