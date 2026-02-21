'use client';

import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { useTranslation } from '@/lib/i18n';

export default function NewWordbookPage() {
  const { t } = useTranslation();

  return (
    <>
      <Header title={t.wordbooks.createWordbook} showBack />
      <div className="space-y-3 p-4">
        <Link
          href="/wordbooks/create"
          className="block rounded-lg border p-4 transition-colors hover:bg-accent"
          data-testid="wordbook-new-create"
        >
          <div className="text-lg font-semibold">{t.wordbooks.createNew}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t.wordbooks.createNewDescription}
          </div>
        </Link>

        <Link
          href="/wordbooks/browse"
          className="block rounded-lg border p-4 transition-colors hover:bg-accent"
          data-testid="wordbook-new-browse"
        >
          <div className="text-lg font-semibold">{t.wordbooks.findShared}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t.wordbooks.findSharedDescription}
          </div>
        </Link>
      </div>
    </>
  );
}
