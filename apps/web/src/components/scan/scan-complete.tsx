'use client';

import { useRouter } from 'next/navigation';
import { CircleCheckIcon as CircleCheck } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { bottomBar, bottomSep } from '@/lib/styles';

interface ScanCompleteProps {
  addedCount: number;
  onAddMore: () => void;
}

export function ScanComplete({ addedCount, onAddMore }: ScanCompleteProps) {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="animate-page flex flex-1 flex-col items-center justify-center gap-4">
        <CircleCheck className="size-12 text-primary" strokeWidth={1.5} />
        <div className="text-center">
          <div className="text-xl font-bold">{t.scan.complete}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {t.scan.wordsAdded(addedCount)}
          </div>
        </div>
      </div>

      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => router.push('/words')}
            data-testid="scan-go-to-words"
          >
            {t.scan.goToWords}
          </Button>
          <Button className="flex-1" onClick={onAddMore} data-testid="scan-add-more">
            {t.scan.addMore}
          </Button>
        </div>
      </div>
    </div>
  );
}
