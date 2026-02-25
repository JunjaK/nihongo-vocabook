'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '@/lib/i18n';

export function SwUpdateNotifier() {
  const { t } = useTranslation();
  const hasShownRef = useRef(false);
  const isProduction = process.env.NODE_ENV === 'production';

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (!isProduction) {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));

          if ('caches' in window) {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
          }
        } catch {
          // noop
        }
      })();
      return;
    }

    function showUpdateToast(waiting: ServiceWorker) {
      if (hasShownRef.current) return;
      hasShownRef.current = true;

      toast(t.pwa.updateAvailable, {
        id: 'sw-update',
        duration: Infinity,
        action: {
          label: t.pwa.updateAction,
          onClick: () => waiting.postMessage({ type: 'SKIP_WAITING' }),
        },
      });
    }

    let registration: ServiceWorkerRegistration | undefined;

    navigator.storage?.persist?.().catch(() => {});

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg;

      // New SW already waiting on page load
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateToast(reg.waiting);
        return;
      }

      // New SW detected while page is open
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(installing);
          }
        });
      });
    });

    // When new SW takes over, reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });

    return;
  }, [isProduction]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
