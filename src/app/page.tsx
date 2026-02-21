'use client';

import Link from 'next/link';
import { BookOpen, Brain, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

export default function LandingPage() {
  const { t } = useTranslation();

  const features = [
    { icon: BookOpen, text: t.landing.feature1 },
    { icon: Brain, text: t.landing.feature2 },
    { icon: Share2, text: t.landing.feature3 },
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[30%] h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-[80px]" />
      </div>

      {/* Content */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        {/* Hero — kanji as visual anchor */}
        <div className="animate-fade-in text-center">
          <div className="text-6xl font-bold tracking-tight text-primary">
            日本語
          </div>
          <div className="mt-1 text-xl font-semibold tracking-wide text-foreground/80">
            VocaBook
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {t.landing.subtitle}
          </p>
        </div>

        {/* Features */}
        <div className="mt-12 w-full max-w-[280px] space-y-2">
          {features.map((feature, i) => (
            <div
              key={i}
              className="animate-stagger flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-muted-foreground transition-colors"
              style={{ '--stagger': i + 3 } as React.CSSProperties}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <feature.icon className="size-4 text-primary" />
              </div>
              <span className="leading-snug">{feature.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="animate-slide-up relative shrink-0 px-4 pb-3" style={{ animationDelay: '200ms' }}>
        <div className="mb-3 h-px bg-border" />
        <div className="flex flex-col gap-2">
          <Link href="/words">
            <Button className="w-full" data-testid="landing-start-button">
              {t.landing.startLearning}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" className="w-full">
              {t.landing.signIn}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
