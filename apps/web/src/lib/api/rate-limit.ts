import type { NextRequest } from 'next/server';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;
/** Sweep old buckets every N inserts so the Map can't grow without bound. */
const CLEANUP_EVERY_N_INSERTS = 256;

/**
 * Resolve the client IP used as the rate-limit bucket key.
 *
 * Priority:
 *   1. `x-real-ip` — set authoritatively by the immediate reverse proxy.
 *      Trusted by default because the proxy overwrites any client-supplied
 *      value.
 *   2. `x-forwarded-for` — last entry (RIGHTMOST). Each proxy appends as it
 *      forwards, so the rightmost is the closest trusted hop's view of the
 *      caller. Reading the leftmost (the old code) is spoofable: any
 *      attacker can prepend their own `x-forwarded-for: 1.2.3.4` and the
 *      app would key on that fabricated address.
 *   3. `'unknown'` — every off-proxy request shares this bucket. Acceptable
 *      because it limits *all* untraceable traffic together.
 *
 * If you ever sit the app behind more than one trusted proxy, change the
 * XFF index to `-N` where N is the number of trusted hops; without that,
 * the rightmost is the *closest* proxy, not the original client.
 */
function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  return 'unknown';
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
