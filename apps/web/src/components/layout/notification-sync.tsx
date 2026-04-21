'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useRepository } from '@/lib/repository/provider';
import {
  isWebPushSupported,
  getNotificationPermission,
  subscribeWebPush,
} from '@/lib/notifications/web-push-client';

/**
 * Silent sync on auth ready.
 *
 * Does NOT prompt for permission — that's explicit in settings.
 * Just keeps the server subscription fresh for already-opted-in users:
 *  - permission granted + setting ON → ensure local subscription exists + server row is current
 *  - permission denied but setting ON → flip setting OFF (honor browser)
 */
export function NotificationSync() {
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !user || syncedRef.current) return;
    if (!isWebPushSupported()) return;

    syncedRef.current = true;

    (async () => {
      try {
        const settings = await repo.study.getQuizSettings();
        if (!settings.notificationEnabled) return;

        const permission = getNotificationPermission();
        if (permission === 'denied') {
          // User revoked at browser level — reflect it back into settings
          await repo.study.updateQuizSettings({ notificationEnabled: false });
          return;
        }
        if (permission !== 'granted') return; // default — wait for explicit opt-in

        // Ensure subscription is registered (safe — uses upsert on endpoint)
        await subscribeWebPush();
      } catch {
        // Non-critical
      }
    })();
  }, [authLoading, user, repo]);

  return null;
}
