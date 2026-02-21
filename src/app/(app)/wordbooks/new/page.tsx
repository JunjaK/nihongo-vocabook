'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';

export default function NewWordbookPage() {
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();

  const handleSubmit = async (values: { name: string; description: string | null }) => {
    await repo.wordbooks.create(values);
    toast.success(t.wordbooks.wordbookCreated);
    router.push('/wordbooks');
  };

  return (
    <>
      <Header title={t.wordbooks.createWordbook} showBack />
      <div className="p-4">
        <WordbookForm onSubmit={handleSubmit} submitLabel={t.common.save} />
      </div>
    </>
  );
}
