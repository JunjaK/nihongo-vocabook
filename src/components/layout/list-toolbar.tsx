'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ListToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSearchClear: () => void;
  searchPlaceholder: string;
  showReading: boolean;
  onToggleReading: () => void;
  showMeaning: boolean;
  onToggleMeaning: () => void;
}

export function ListToolbar({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onSearchClear,
  searchPlaceholder,
  showReading,
  onToggleReading,
  showMeaning,
  onToggleMeaning,
}: ListToolbarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSearchSubmit();
  };

  return (
    <div className="sticky top-14 z-[9] bg-background">
      <div className="flex items-center gap-2 px-4 py-2">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={searchPlaceholder}
          className="pl-8 pr-8"
          data-testid="list-toolbar-search-input"
        />
        {searchValue && (
          <button
            type="button"
            onClick={onSearchClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="list-toolbar-search-clear"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>
      <Button
        variant={showReading ? 'default' : 'ghost'}
        size="icon"
        onClick={onToggleReading}
        data-testid="list-toolbar-toggle-reading"
        aria-label="Toggle reading"
      >
        <span className="text-sm font-bold">あ</span>
      </Button>
      <Button
        variant={showMeaning ? 'default' : 'ghost'}
        size="icon"
        onClick={onToggleMeaning}
        data-testid="list-toolbar-toggle-meaning"
        aria-label="Toggle meaning"
      >
        <span className="text-sm font-bold">意</span>
      </Button>
      </div>
      <div className="mx-4 h-px bg-border" />
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
