'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { createClient } from '@/lib/supabase/client';

const STORAGE_CONSENT_KEY = 'vocabook_storage_consent';

function getLocalConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_CONSENT_KEY) === 'true';
}

function setLocalConsent(): void {
  localStorage.setItem(STORAGE_CONSENT_KEY, 'true');
}

export function ConsentGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);

  const isProd = process.env.NODE_ENV === 'production';

  const [consented, setConsented] = useState<boolean | null>(isProd ? null : true);
  const [declined, setDeclined] = useState(false);

  const checkConsent = useCallback(async () => {
    // Skip consent in non-production environments
    if (!isProd) {
      setConsented(true);
      return;
    }

    // Guest: check localStorage
    if (!user) {
      setConsented(getLocalConsent());
      return;
    }

    // Authenticated: check DB
    const supabase = createClient();
    const { data } = await supabase
      .from('user_settings')
      .select('storage_agreed_at')
      .eq('user_id', user.id)
      .single();

    if (data?.storage_agreed_at) {
      setConsented(true);
      return;
    }

    // Auto-migrate localStorage consent → DB
    if (getLocalConsent()) {
      await supabase
        .from('user_settings')
        .update({ storage_agreed_at: new Date().toISOString() })
        .eq('user_id', user.id);
      setConsented(true);
      return;
    }

    setConsented(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    checkConsent();
  }, [authLoading, checkConsent]);

  const handleAgree = async () => {
    setLocalConsent();

    if (user) {
      const supabase = createClient();
      await supabase
        .from('user_settings')
        .update({ storage_agreed_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    setConsented(true);
    setDeclined(false);
  };

  // Still loading auth or consent status
  if (authLoading || consented === null) {
    return null;
  }

  // Show consent form
  if (!consented) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-center text-lg">
              {t.consent.storageTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t.consent.storageDescription}
            </p>

            {declined && (
              <p className="text-sm text-destructive">
                {t.consent.storageDeclinedMessage}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={handleAgree} className="w-full">
                {t.consent.storageAgree}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => setDeclined(true)}
              >
                {t.consent.storageDecline}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
