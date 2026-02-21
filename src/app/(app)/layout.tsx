import type { ReactNode } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
      <BottomNav />
    </>
  );
}
