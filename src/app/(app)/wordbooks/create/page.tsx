'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';

export default function CreateWordbookPage() {
  const router = useRouter();
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  const handleSubmit = async (values: { name: string; description: string | null; isShared?: boolean; tags?: string[] }) => {
    try {
      await repo.wordbooks.create(values);
      invalidateListCache('wordbooks');
      toast.success(t.wordbooks.wordbookCreated);
      router.push('/wordbooks');
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORDBOOK') {
        toast.error(t.wordbooks.duplicateWordbook);
      } else {
        throw err;
      }
    }
  };

  return (
    <>
      <Header title={t.wordbooks.createWordbook} showBack />
      <WordbookForm
        onSubmit={handleSubmit}
        submitLabel={t.common.save}
        showShareToggle={!!user}
      />
    </>
  );
}
