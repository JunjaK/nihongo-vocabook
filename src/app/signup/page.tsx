'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import {
  getLocalWordCount,
  migrateToSupabase,
} from '@/lib/migration/migrate-to-supabase';
import { useTranslation } from '@/lib/i18n';

export default function SignupPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const localCount = await getLocalWordCount();
    if (localCount > 0) {
      const confirmed = window.confirm(t.auth.migrationPrompt(localCount));
      if (confirmed) {
        try {
          const result = await migrateToSupabase(supabase);
          toast.success(t.auth.migrationSuccess(result.wordCount));
        } catch {
          toast.error(t.auth.migrationFailed);
        }
      }
    }

    toast.success(t.auth.accountCreated);
    router.push('/words');
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-center text-xl">{t.auth.signUp}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                minLength={6}
                required
                data-testid="signup-password-input"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              data-testid="signup-submit-button"
            >
              {loading ? t.auth.creatingAccount : t.auth.createAccount}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {t.auth.hasAccount}{' '}
            <Link href="/login" className="text-primary underline">
              {t.auth.signIn}
            </Link>
          </div>
          <div className="mt-2 text-center text-sm text-muted-foreground">
            <Link href="/words" className="text-primary underline">
              {t.auth.continueAsGuest}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
