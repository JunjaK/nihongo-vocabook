'use client';

import Link from 'next/link';
import { Sparkles } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { emptyState, emptyIcon } from '@/lib/styles';

export type AssistantFallbackVariant =
  | 'web-not-supported'
  | 'device-too-weak'
  | 'model-not-installed';

interface Props {
  variant: AssistantFallbackVariant;
}

export function AssistantFallback({ variant }: Props) {
  const { t } = useTranslation();

  if (variant === 'web-not-supported') {
    return (
      <div className={emptyState}>
        <Sparkles className={emptyIcon} />
        <div className="font-medium">{t.assistant.fallback.webNotSupported}</div>
        <div className="mt-1 text-sm">{t.assistant.fallback.webNotSupportedHint}</div>
      </div>
    );
  }

  if (variant === 'device-too-weak') {
    return (
      <div className={emptyState}>
        <Sparkles className={emptyIcon} />
        <div className="font-medium">{t.assistant.fallback.deviceTooWeak}</div>
      </div>
    );
  }

  // model-not-installed
  return (
    <div className={emptyState}>
      <Sparkles className={emptyIcon} />
      <div className="font-medium">{t.assistant.fallback.modelNotInstalled}</div>
      <div className="mt-4">
        <Link href="/settings/ocr">
          <Button>{t.assistant.fallback.modelNotInstalledCta}</Button>
        </Link>
      </div>
    </div>
  );
}
