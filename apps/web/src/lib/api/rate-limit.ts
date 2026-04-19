import type { NextRequest } from 'next/server';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;
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

export function createAnonymousRateLimiter(opts?: {
  windowMs?: number;
  maxRequests?: number;
}) {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const store = new Map<string, RateLimitBucket>();

  return function isLimited(request: NextRequest, nowMs = Date.now()): boolean {
    const userAgent = request.headers.get('user-agent') ?? 'unknown';
    const key = `${getClientIp(request)}:${userAgent.slice(0, 120)}`;
    const current = store.get(key);

    if (!current || nowMs - current.windowStartMs >= windowMs) {
      store.set(key, { count: 1, windowStartMs: nowMs });
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
