'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check } from '@/components/ui/icons';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n';
import { btnLg } from '@/lib/styles';
import { cn } from '@/lib/utils';

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
    if (!saved) return;
    // Hydrating from localStorage on mount — SSR cannot read it, so this
    // setState is the documented escape hatch. The alternative
    // (useSyncExternalStore) doesn't fit since the value seeds editable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(saved);
    setRememberEmail(true);
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
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
      {/* Branding */}
      <div className="flex shrink-0 flex-col items-center gap-3 px-8 pb-6 pt-8">
        <Image
          src="/main_logo.png"
          alt="NiVoca"
          width={180}
          height={44}
          priority
          className="h-auto w-[180px] dark:invert dark:brightness-200 dark:contrast-100"
        />
        <p className="text-body text-muted-foreground">{t.auth.welcomeBack}</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="shrink-0">
        <div className="space-y-4 px-6 pt-2">
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
            <label className="flex cursor-pointer items-center gap-2 text-caption text-muted-foreground">
              <span className={cn(
                'flex size-[18px] shrink-0 items-center justify-center rounded-sm border-[1.5px]',
                rememberEmail ? 'border-primary bg-primary' : 'border-border bg-background'
              )}>
                {rememberEmail && <Check className="size-3 text-white" />}
              </span>
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
                className="sr-only"
                data-testid="login-remember-email"
              />
              {t.auth.rememberEmail}
            </label>
            <Link href="/words" className="text-caption font-medium text-primary">
              {t.auth.continueAsGuest}
            </Link>
          </div>
        </div>

        {/* Spacer — equalizes content height with signup so email position matches */}
        <div className="h-[191px] shrink-0" />

        {/* Bottom buttons */}
        <div className="shrink-0 space-y-3 px-6 pb-8 pt-[30px]">
          <Button
            type="submit"
            className={cn(btnLg, 'w-full text-title-sm font-semibold')}
            disabled={loading}
            data-testid="login-submit-button"
          >
            {loading ? t.auth.signingIn : t.auth.signIn}
          </Button>
          <div className="flex items-center justify-center gap-1 text-reading">
            <span className="text-muted-foreground">{t.auth.noAccount}</span>
            <Link href="/signup" className="font-semibold text-primary" data-testid="login-goto-signup">
              {t.auth.signUp}
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
