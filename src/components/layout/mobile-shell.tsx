'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useScanStore } from '@/stores/scan-store';
import { useTranslation } from '@/lib/i18n';

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const scanStatus = useScanStore((s) => s.status);
  const prevStatusRef = useRef(scanStatus);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = scanStatus;

    // Only toast when transitioning TO preview from a running state, and not on the scan page
    if (
      scanStatus === 'preview' &&
      (prev === 'extracting' || prev === 'enriching') &&
      pathname !== '/words/scan'
    ) {
      toast.info(t.scan.extractionReady, {
        action: {
          label: t.scan.title,
          onClick: () => router.push('/words/scan'),
        },
      });
    }
  }, [scanStatus, pathname, router, t]);

  return (
    <div className="h-dvh bg-muted">
      <div className="mx-auto flex h-dvh max-w-md flex-col bg-background shadow-sm">
        {children}
      </div>
    </div>
  );
}
