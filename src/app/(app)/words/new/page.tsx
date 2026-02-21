'use client';

import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { useTranslation } from '@/lib/i18n';

export default function NewWordPage() {
  const { t } = useTranslation();

  return (
    <>
      <Header title={t.words.addWord} showBack />
      <div className="space-y-3 p-4">
        <Link
          href="/words/create"
          className="animate-stagger block rounded-lg border p-4 transition-colors hover:bg-accent"
          style={{ '--stagger': 0 } as React.CSSProperties}
          data-testid="word-new-dictionary"
        >
          <div className="text-lg font-semibold">{t.scan.dictionarySearch}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t.wordForm.searchPlaceholder}
          </div>
        </Link>

        <Link
          href="/words/scan"
          className="animate-stagger block rounded-lg border p-4 transition-colors hover:bg-accent"
          style={{ '--stagger': 1 } as React.CSSProperties}
          data-testid="word-new-scan"
        >
          <div className="text-lg font-semibold">{t.scan.fromImage}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t.scan.fromImageDescription}
          </div>
        </Link>
      </div>
    </>
  );
}
