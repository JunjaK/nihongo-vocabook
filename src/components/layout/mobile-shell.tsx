'use client';

import type { ReactNode } from 'react';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh bg-muted">
      <div className="mx-auto flex h-dvh max-w-md flex-col bg-background shadow-sm">
        {children}
      </div>
    </div>
  );
}
