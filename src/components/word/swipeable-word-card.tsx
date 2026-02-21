'use client';

import { useState, useRef, type ReactNode } from 'react';
import { WordCard } from './word-card';
import type { Word } from '@/types/word';

interface SwipeableWordCardProps {
  word: Word;
  showReading: boolean;
  showMeaning: boolean;
  actionIcon: ReactNode;
  actionLabel: string;
  actionColor: string;
  onAction: (wordId: string) => void;
}

const ACTION_WIDTH = 72;
const SNAP_THRESHOLD = ACTION_WIDTH * 0.5;

export function SwipeableWordCard({
  word,
  showReading,
  showMeaning,
  actionIcon,
  actionLabel,
  actionColor,
  onAction,
}: SwipeableWordCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const startX = useRef(0);
  const currentX = useRef(0);
  const swiping = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping.current) return;
    const diff = e.touches[0].clientX - startX.current;
    // Only allow swipe right (negative offset = left, positive = right — we want left to reveal action)
    const clamped = Math.min(0, Math.max(-ACTION_WIDTH, diff));
    currentX.current = clamped;
    setOffsetX(clamped);
  };

  const handleTouchEnd = () => {
    swiping.current = false;
    if (currentX.current <= -SNAP_THRESHOLD) {
      setOffsetX(-ACTION_WIDTH);
    } else {
      setOffsetX(0);
    }
  };

  const handleAction = () => {
    setOffsetX(0);
    onAction(word.id);
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Action button behind the card */}
      <button
        onClick={handleAction}
        className={`absolute right-0 top-0 flex h-full w-[72px] flex-col items-center justify-center gap-1 text-white ${actionColor}`}
        aria-label={actionLabel}
      >
        {actionIcon}
        <span className="text-[10px] font-medium">{actionLabel}</span>
      </button>

      {/* Card container */}
      <div
        className="relative bg-background transition-transform duration-150 ease-out"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping.current ? 'none' : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <WordCard
          word={word}
          showReading={showReading}
          showMeaning={showMeaning}
        />
      </div>
    </div>
  );
}
