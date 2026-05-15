'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

type Mode = 'active' | 'mastered';

interface Props {
  current: Mode;
}

export function WordsListToggle({ current }: Props) {
  const router = useRouter();
  const { t } = useTranslation();

  function handleSwitch(target: Mode) {
    if (target === current) return;
    const href = target === 'active' ? '/words' : '/mastered';
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      document.startViewTransition(() => {
        router.push(href);
      });
    } else {
      router.push(href);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="words-list-mode"
      className="inline-flex items-center rounded-full bg-secondary p-0.5 text-badge font-medium"
    >
      <ToggleButton
        label={t.words.activeTab}
        selected={current === 'active'}
        onClick={() => handleSwitch('active')}
        testId="words-toggle-active"
      />
      <ToggleButton
        label={t.words.masteredTab}
        selected={current === 'mastered'}
        onClick={() => handleSwitch('mastered')}
        testId="words-toggle-mastered"
      />
    </div>
  );
}

interface ToggleButtonProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
}

function ToggleButton({ label, selected, onClick, testId }: ToggleButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'rounded-full px-3 py-1 transition-colors',
        selected
          ? 'bg-background text-foreground shadow-sm'
          : 'text-text-tertiary hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
