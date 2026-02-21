'use client';

import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';
import { WordCard } from './word-card';
import type { Word } from '@/types/word';

interface WordCardAction {
  label: string;
  onAction: (wordId: string) => void;
  variant?: 'default' | 'destructive';
}

interface WordCardWithMenuProps {
  word: Word;
  showReading: boolean;
  showMeaning: boolean;
  actions: WordCardAction[];
}

export function WordCardWithMenu({
  word,
  showReading,
  showMeaning,
  actions,
}: WordCardWithMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <WordCard
            word={word}
            showReading={showReading}
            showMeaning={showMeaning}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => (
          <ContextMenuItem
            key={action.label}
            variant={action.variant}
            onClick={() => action.onAction(word.id)}
          >
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
