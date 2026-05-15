import type { NextRequest } from 'next/server';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;
/** Sweep old buckets every N inserts so the Map can't grow without bound. */
const CLEANUP_EVERY_N_INSERTS = 256;
const BOT_UA_PATTERN =
  /(bot|crawler|spider|curl|wget|python-requests|httpclient|axios|postman|insomnia|node-fetch)/i;

export interface BlockDecision {
  status: 403 | 429;
  error: string;
}

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function shouldBlockAnonymousBot(request: NextRequest): BlockDecision | null {
  const userAgent = request.headers.get('user-agent') ?? '';
  if (!userAgent || BOT_UA_PATTERN.test(userAgent)) {
    return { status: 403, error: 'BOT_TRAFFIC_BLOCKED' };
  }
  return null;
}

interface RateLimitBucket {
  count: number;
  windowStartMs: number;
}

/**
 * Per-IP sliding-window rate limiter, in-memory.
 *
 * Limitations to be aware of:
 *   - State lives in the Node process. Behind multiple replicas, each replica
 *     enforces its own bucket — global limit is N × `maxRequests`. Move to a
 *     shared store (Redis/Upstash KV) before horizontal scaling.
 *   - Behind a proxy, getClientIp() depends on `x-forwarded-for` being set
 *     correctly upstream. If the proxy doesn't forward it, every request
 *     looks like `'unknown'` and shares a single bucket.
 *   - Process restarts wipe state. Acceptable for soft DoS protection;
 *     unacceptable for billing/abuse enforcement.
 *
 * The UA is intentionally NOT part of the bucket key — rotating UA per
 * request would have bypassed the limit entirely.
 */
export function createAnonymousRateLimiter(opts?: {
  windowMs?: number;
  maxRequests?: number;
}) {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const store = new Map<string, RateLimitBucket>();
  let insertsSinceSweep = 0;

  function sweep(nowMs: number): void {
    for (const [k, v] of store) {
      if (nowMs - v.windowStartMs >= windowMs) store.delete(k);
    }
    insertsSinceSweep = 0;
  }

  return function isLimited(request: NextRequest, nowMs = Date.now()): boolean {
    const key = getClientIp(request);
    const current = store.get(key);

    if (!current || nowMs - current.windowStartMs >= windowMs) {
      store.set(key, { count: 1, windowStartMs: nowMs });
      insertsSinceSweep += 1;
      if (insertsSinceSweep >= CLEANUP_EVERY_N_INSERTS) sweep(nowMs);
      return false;
    }

    current.count += 1;
    if (current.count > maxRequests) {
      return true;
    }
    store.set(key, current);
    return false;
  };
}
