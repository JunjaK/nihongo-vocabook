'use client';

import type { ReactNode } from 'react';

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background shadow-sm">
        {children}
      </div>
    </div>
  );
}
