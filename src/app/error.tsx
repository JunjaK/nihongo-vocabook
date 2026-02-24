'use client';

import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <p className="text-lg font-medium text-foreground">
        {t.common.error}
      </p>
      <Button onClick={reset}>{t.common.tryAgain}</Button>
    </div>
  );
}
