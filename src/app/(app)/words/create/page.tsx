'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { WordForm } from '@/components/word/word-form';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';

export default function CreateWordPage() {
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();

  const handleSubmit = async (data: Parameters<typeof repo.words.create>[0]) => {
    try {
      await repo.words.create(data);
      toast.success(t.words.wordAdded);
      router.push('/words');
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
        toast.error(t.words.duplicateWord);
      } else {
        throw err;
      }
    }
  };

  return (
    <>
      <Header title={t.words.addWord} showBack />
      <WordForm onSubmit={handleSubmit} submitLabel={t.words.addWord} />
    </>
  );
}
