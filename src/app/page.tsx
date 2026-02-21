'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {t.landing.title}
        </h1>
        <p className="text-muted-foreground">
          {t.landing.subtitle}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3">
          <Link href="/words">
            <Button className="w-48" data-testid="landing-start-button">
              {t.landing.startLearning}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" className="w-48">
              {t.landing.signIn}
            </Button>
          </Link>
        </div>
      </div>

      <div className="max-w-xs space-y-4 text-left text-sm text-muted-foreground">
        <div className="flex items-start gap-3">
          <span className="shrink-0 text-lg">📖</span>
          <span>{t.landing.feature1}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="shrink-0 text-lg">🧠</span>
          <span>{t.landing.feature2}</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="shrink-0 text-lg">☁️</span>
          <span>{t.landing.feature3}</span>
        </div>
      </div>
    </div>
  );
}
