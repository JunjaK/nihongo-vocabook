'use client';

import { ExternalLink, Smartphone } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { useTranslation } from '@/lib/i18n';

// TODO: replace with the production App Store URL once the iOS build ships.
const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL ?? 'https://apps.apple.com';

interface AppOnlyGateProps {
  /** Header title — typically the original page title so back navigation stays sane. */
  title: string;
  /** If true, render a `Header` with back button. Pass false for embedded use. */
  showHeader?: boolean;
}

export function AppOnlyGate({ title, showHeader = true }: AppOnlyGateProps) {
  const { t } = useTranslation();
  return (
    <>
      {showHeader && <Header title={title} showBack />}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <Smartphone className="size-12 text-muted-foreground" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t.aiModel.appOnlyTitle}</h2>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t.aiModel.appOnlyDescription}
          </p>
        </div>
        <Button asChild>
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
            {t.aiModel.appOnlyOpenStore}
            <ExternalLink className="ml-1 size-4" aria-hidden />
          </a>
        </Button>
      </div>
    </>
  );
}
