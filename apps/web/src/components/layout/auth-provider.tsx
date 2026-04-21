'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { createClient } from '@/lib/supabase/client';
import {
  isNativeApp,
  notifyReady,
  persistAuthToken,
  onNativeMessage,
} from '@/lib/native-bridge';

export function AuthProvider({ children }: { children: ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser);

  // Core auth: get user + listen for state changes
  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);

      // Persist refresh token to native SecureStore
      if (isNativeApp() && session?.refresh_token) {
        persistAuthToken(session.refresh_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [setUser]);

  // Native bridge: listen for RESTORE_AUTH, then signal READY
  useEffect(() => {
    if (!isNativeApp()) return;

    const supabase = createClient();

    // Set up listener BEFORE notifyReady to avoid race condition
    const cleanup = onNativeMessage(async (msg) => {
      if (msg.type === 'RESTORE_AUTH') {
        const { error } = await supabase.auth.setSession({
          refresh_token: msg.refreshToken,
          access_token: '', // Supabase will refresh using the refresh token
        });
        if (error) {
          console.warn('[NativeBridge] Failed to restore auth:', error.message);
        }
      }

    });

    notifyReady();

    return cleanup;
  }, []);

  return <>{children}</>;
}
