import type { ReactNode } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <BottomNav />
    </>
  );
}
