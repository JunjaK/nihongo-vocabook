'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n';

function VerifyEmailContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const [resending, setResending] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      const supabase = createClient();
      await supabase.auth.resend({ type: 'signup', email });
      toast.success(t.auth.resendSuccess);
    } catch {
      toast.error('Failed to resend');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[20%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-[80px]" />
      </div>

      {/* Branding */}
      <div className="relative shrink-0 pb-8 pt-12 text-center">
        <div className="text-4xl font-bold tracking-tight text-primary">日本語</div>
        <div className="mt-1 text-base font-semibold tracking-wide text-foreground/80">VocaBook</div>
        <p className="mt-2 text-xs text-muted-foreground">{t.landing.subtitle}</p>
      </div>

      {/* Content */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        <Card className="mx-auto max-w-[360px]">
          <CardContent className="pt-6 text-center">
            <MailIcon className="mx-auto mb-4 size-12 text-primary" />
            <h2 className="text-lg font-semibold">{t.auth.verifyEmailTitle}</h2>

            {email && (
              <p className="mt-3 whitespace-pre-line text-sm text-foreground">
                {t.auth.verifyEmailDesc(email)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {t.auth.verifyEmailHint}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bottom buttons */}
      <div className="relative shrink-0 px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <div className="flex flex-col gap-2">
          {email && (
            <Button
              className="w-full"
              onClick={handleResend}
              disabled={resending}
              data-testid="verify-resend-button"
            >
              {t.auth.resendEmail}
            </Button>
          )}
          <Link href="/login">
            <Button variant="secondary" className="w-full" data-testid="verify-back-login">
              {t.auth.backToLogin}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
