'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { bottomSep } from '@/lib/styles';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n';

const REMEMBERED_EMAIL_KEY = 'vocabook_remembered_email';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) {
      setEmail(saved);
      setRememberEmail(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (rememberEmail) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message === 'Email not confirmed') {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      toast.error(error.message);
      setLoading(false);
      return;
    }

    router.push('/words');
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

      {/* Form */}
      <form onSubmit={handleSubmit} className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <Card className="mx-auto max-w-[360px]">
            <CardHeader>
              <CardTitle className="text-center text-lg">{t.auth.signIn}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  data-testid="login-email-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t.auth.password}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.password}
                  required
                  data-testid="login-password-input"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={rememberEmail}
                    onChange={(e) => setRememberEmail(e.target.checked)}
                    className="size-4 rounded border-border accent-primary"
                    data-testid="login-remember-email"
                  />
                  {t.auth.rememberEmail}
                </label>
                <Link href="/words" className="text-sm text-primary underline">
                  {t.auth.continueAsGuest}
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bottom buttons */}
        <div className="relative shrink-0 px-4 pb-3">
          <div className={bottomSep} />
          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              data-testid="login-submit-button"
            >
              {loading ? t.auth.signingIn : t.auth.signIn}
            </Button>
            <Link href="/signup">
              <Button type="button" variant="outline" className="w-full" data-testid="login-goto-signup">
                {t.auth.goToSignup}
              </Button>
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
