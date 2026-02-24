'use client';

import { useRef, useState, useCallback } from 'react';
import { Check, Undo2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { WordCard } from './word-card';
import type { Word } from '@/types/word';

export interface WordCardAction {
  label: string;
  onAction: (wordId: string) => void;
  variant?: 'default' | 'destructive';
}

interface SwipeableWordCardProps {
  word: Word;
  showReading: boolean;
  showMeaning: boolean;
  swipeColor: 'green' | 'orange';
  /** First action is used as the swipe action. */
  contextMenuActions: WordCardAction[];
}

const SWIPE_THRESHOLD = 80;
const MAX_SWIPE = 150;

export function SwipeableWordCard({
  word,
  showReading,
  showMeaning,
  swipeColor,
  contextMenuActions,
}: SwipeableWordCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const touchRef = useRef({ startX: 0, startY: 0, swiping: false, locked: false });

  const swipeAction = contextMenuActions[0];

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, swiping: false, locked: false };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const ref = touchRef.current;
    const deltaX = touch.clientX - ref.startX;
    const deltaY = touch.clientY - ref.startY;

    // Determine direction lock on first significant move
    if (!ref.locked) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        ref.locked = true;
        ref.swiping = Math.abs(deltaX) > Math.abs(deltaY) && deltaX < 0;
      }
    }

    if (!ref.swiping) return;

    // Prevent vertical scroll while swiping
    e.preventDefault();
    const clamped = Math.max(-MAX_SWIPE, Math.min(0, deltaX));
    setOffsetX(clamped);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchRef.current.swiping) {
      setOffsetX(0);
      return;
    }

    if (offsetX < -SWIPE_THRESHOLD) {
      // Dismiss animation
      setDismissed(true);
      setTimeout(() => swipeAction.onAction(word.id), 200);
    } else {
      // Spring back
      setOffsetX(0);
    }
  }, [offsetX, swipeAction, word.id]);

  if (dismissed) {
    return (
      <div className="h-0 overflow-hidden opacity-0 transition-all duration-200" />
    );
  }

  const swipeBg = swipeColor === 'green' ? 'bg-green-500' : 'bg-orange-500';
  const SwipeIcon = swipeColor === 'green' ? Check : Undo2;
  const isDragging = touchRef.current.swiping;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative overflow-hidden rounded-lg">
          {/* Action panel behind the card — only visible during swipe */}
          {offsetX < 0 && (
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-end rounded-lg px-4 text-white',
                swipeBg,
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>{swipeAction.label}</span>
                <SwipeIcon className="size-5" />
              </div>
            </div>
          )}

          {/* Sliding card */}
          <div
            className="relative rounded-lg bg-background"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              transform: `translateX(${offsetX}px)`,
              transition: isDragging ? 'none' : 'transform 0.2s ease',
            }}
          >
            <WordCard
              word={word}
              showReading={showReading}
              showMeaning={showMeaning}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {contextMenuActions.map((action) => (
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
