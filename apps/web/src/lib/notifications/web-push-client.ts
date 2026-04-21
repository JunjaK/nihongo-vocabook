/**
 * Web Push subscription helpers.
 *
 * Browser-side only — all functions guard on `typeof window`.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current permission state (granted/denied/default). */
export function getNotificationPermission(): NotificationPermission | null {
  if (!isWebPushSupported()) return null;
  return Notification.permission;
}

/**
 * Request notification permission and return whether it was granted.
 * Safe to call multiple times — browsers no-op after first decision.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const cleaned = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(cleaned);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/**
 * Ensure a PushSubscription exists and is registered on the server.
 * - Creates a new subscription if the user has none
 * - Sends it to /api/notifications/web-subscribe
 * - Returns the subscription endpoint, or null on failure
 */
export async function subscribeWebPush(): Promise<string | null> {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[web-push] VAPID public key missing');
    return null;
  }
  const reg = await getRegistration();
  if (!reg) return null;

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      console.warn('[web-push] subscribe failed', err);
      return null;
    }
  }

  const json = subscription.toJSON();
  const body = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    userAgent: navigator.userAgent,
  };

  try {
    const res = await fetch('/api/notifications/web-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[web-push] server rejected subscription', res.status);
      return null;
    }
    return subscription.endpoint;
  } catch (err) {
    console.warn('[web-push] failed to POST subscription', err);
    return null;
  }
}

/**
 * Remove local PushSubscription and notify the server.
 */
export async function unsubscribeWebPush(): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return false;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return true;

  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch (err) {
    console.warn('[web-push] failed to unsubscribe locally', err);
  }

  try {
    await fetch(
      `/api/notifications/web-subscribe?endpoint=${encodeURIComponent(endpoint)}`,
      { method: 'DELETE' },
    );
  } catch (err) {
    console.warn('[web-push] failed to notify server of unsubscribe', err);
  }
  return true;
}

export async function getCurrentSubscriptionEndpoint(): Promise<string | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
