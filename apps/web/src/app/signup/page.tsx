'use client';

import { useState, useEffect } from 'react';
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

const JLPT_LEVELS = [5, 4, 3, 2, 1] as const;

export default function SignupPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [jlptLevel, setJlptLevel] = useState(3);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Auto-check if user agreed on the privacy page.
  // Hydrating consent flag from sessionStorage — SSR cannot read it.
  useEffect(() => {
    const agreed = sessionStorage.getItem('vocabook_privacy_agreed');
    if (agreed !== 'true') return;
    sessionStorage.removeItem('vocabook_privacy_agreed');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrivacyAgreed(true);
  }, []);

  const passwordHasLetter = /[a-zA-Z]/.test(password);
  const passwordHasNumber = /\d/.test(password);
  const passwordValid = password.length >= 8 && passwordHasLetter && passwordHasNumber;
  const passwordTouched = password.length > 0;
  const passwordMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const canSubmit =
    email.trim() &&
    passwordValid &&
    passwordConfirm.length > 0 &&
    !passwordMismatch &&
    privacyAgreed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { jlpt_level: jlptLevel, privacy_agreed: true },
      },
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
        <p className="text-body text-muted-foreground">{t.auth.createYourAccount}</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="shrink-0">
        <div className="space-y-3.5 px-6 pt-2">
              <div className="space-y-2">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  data-testid="signup-email-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t.auth.password}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.minPassword}
                  minLength={8}
                  required
                  data-testid="signup-password-input"
                />
                <p className={`text-caption ${passwordTouched && !passwordValid ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {t.auth.passwordRule}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password-confirm">{t.auth.passwordConfirm}</Label>
                <Input
                  id="password-confirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder={t.auth.passwordConfirm}
                  required
                  data-testid="signup-password-confirm-input"
                />
                {passwordMismatch && (
                  <p className="text-caption text-destructive">
                    {t.auth.passwordMismatch}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t.auth.jlptLevel}</Label>
                <div className="flex gap-2">
                  {JLPT_LEVELS.map((level) => (
                    <Button
                      key={level}
                      type="button"
                      variant={jlptLevel === level ? 'default' : 'outline'}
                      className="h-10 flex-1 rounded-md"
                      onClick={() => setJlptLevel(level)}
                      data-testid={`signup-jlpt-n${level}`}
                    >
                      N{level}
                    </Button>
                  ))}
                </div>
              </div>
              {/* Privacy consent */}
              <div className="pt-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <span className={cn(
                    'flex size-[18px] shrink-0 items-center justify-center rounded-sm border-[1.5px]',
                    privacyAgreed ? 'border-primary bg-primary' : 'border-border bg-background'
                  )}>
                    {privacyAgreed && <Check className="size-3 text-white" />}
                  </span>
                  <input
                    type="checkbox"
                    checked={privacyAgreed}
                    onChange={(e) => setPrivacyAgreed(e.target.checked)}
                    className="sr-only"
                    data-testid="signup-privacy-checkbox"
                  />
                  <Link
                    href="/privacy?from=signup"
                    className="text-caption font-medium text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.auth.privacyAgree}
                  </Link>
                </label>
              </div>
        </div>

        {/* Bottom buttons */}
        <div className="shrink-0 space-y-3 px-6 pb-8 pt-[30px]">
          <Button
            type="submit"
            className={cn(btnLg, 'w-full text-title-sm font-semibold')}
            disabled={loading || !canSubmit}
            data-testid="signup-submit-button"
          >
            {loading ? t.auth.creatingAccount : t.auth.createAccount}
          </Button>
          <div className="flex items-center justify-center gap-1 text-reading">
            <span className="text-muted-foreground">{t.auth.hasAccount}</span>
            <Link href="/login" className="font-semibold text-primary" data-testid="signup-goto-login">
              {t.auth.signIn}
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
