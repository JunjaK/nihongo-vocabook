/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// HuggingFace model downloads (Gemma 4 weights, ~3.2 GB across 1.5 GB ONNX
// shards) must bypass serwist's `defaultCache`. The default cross-origin rule
// is NetworkFirst with `cacheName: 'cross-origin'`, `maxEntries: 32`, and
// `networkTimeoutSeconds: 10` — none of those are safe for our case:
//   - `cache.put()` on multi-hundred-MB Response bodies can fail or stall on
//     browsers with per-entry size limits, corrupting transformers.js's
//     progress stream and stranding downloads partway through.
//   - `maxEntries: 32` evicts older HF chunks once mixed with Supabase API
//     responses, leading to repeat re-downloads even after the page reloads.
//   - The 10s network timeout is harmless for fast TTFB but bites on slow
//     mobile connections where header response can exceed 10s.
// transformers.js maintains its own Cache Storage (`nivoca-gemma-cache`, set
// via `env.cacheKey`) so we don't need SW-level caching here — NetworkOnly
// keeps the request fully outside serwist's caching layer.
const HF_HOSTS = /^https:\/\/(huggingface\.co|cdn-lfs(?:-.+?)?\.huggingface\.co|cas-server\.xethub\.hf\.co)\//;
const runtimeCaching = [
  {
    matcher: ({ url }: { url: URL }) => HF_HOSTS.test(url.href),
    handler: new NetworkOnly(),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'NiVoca', {
      body: data.body ?? 'Time to review your words!',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: { url: '/quiz' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) ?? '/quiz';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});

serwist.addEventListeners();
