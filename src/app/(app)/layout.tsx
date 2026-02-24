import type { ReactNode } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { ConsentGate } from '@/components/layout/consent-gate';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ConsentGate>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <BottomNav />
    </ConsentGate>
  );
}
