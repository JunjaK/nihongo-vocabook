'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowUpDown, Check } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';

export function SortDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="Sort"
      >
        <ArrowUpDown className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-md border bg-popover py-1 shadow-md">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Check className={`size-4 ${value === opt.value ? 'opacity-100' : 'opacity-0'}`} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
