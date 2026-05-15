'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useNavigationLockStore } from '@/stores/navigation-lock-store';

interface HeaderProps {
  title: string;
  /** Subtitle / metadata next to the title. Plain string or a React node
   *  (e.g. a segmented toggle). */
  desc?: ReactNode;
  actions?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  allowBackWhenLocked?: boolean;
}

export function Header({
  title,
  desc,
  actions,
  showBack,
  onBack,
  allowBackWhenLocked = false,
}: HeaderProps) {
  const router = useRouter();
  const navLocked = useNavigationLockStore((s) => s.lockCount > 0);

  const isSubHeader = showBack || !!onBack;

  if (isSubHeader) {
    return (
      <header className="sticky top-0 z-10 flex h-14 items-center bg-background pl-3 pr-5 gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack ?? (() => router.back())}
          disabled={navLocked && !allowBackWhenLocked}
          aria-label="Go back"
        >
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="flex items-end gap-2.5">
          <h1 className="text-section font-semibold text-foreground">{title}</h1>
          {typeof desc === 'string' ? (
            <span className="text-badge font-medium text-text-tertiary">{desc}</span>
          ) : (
            desc
          )}
        </div>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between bg-background px-5">
      <div className="flex items-end gap-2.5">
        <h1 className="text-section font-semibold text-foreground">{title}</h1>
        {typeof desc === 'string' ? (
          <span className="text-badge font-medium text-text-tertiary pb-0.5">{desc}</span>
        ) : (
          desc
        )}
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </header>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
    >
      <path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" />
    </svg>
  );
}
