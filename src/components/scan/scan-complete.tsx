'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { pageWrapper, scrollArea, bottomBar, bottomSep } from '@/lib/styles';

interface ScanCompleteProps {
  addedCount: number;
  onAddMore: () => void;
}

export function ScanComplete({ addedCount, onAddMore }: ScanCompleteProps) {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <div className={pageWrapper}>
      <div className={scrollArea}>
        <div className="animate-page flex flex-1 flex-col items-center justify-center gap-6">
          <CheckCircleIcon className="size-16 text-green-500" />
          <div className="text-center">
            <div className="text-2xl font-bold">{t.scan.complete}</div>
            <div className="mt-1 text-muted-foreground">
              {t.scan.wordsAdded(addedCount)}
            </div>
          </div>
        </div>
      </div>

      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={onAddMore} data-testid="scan-add-more">
            {t.scan.addMore}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => router.push('/words')}
            data-testid="scan-go-to-words"
          >
            {t.scan.goToWords}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}
