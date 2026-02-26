import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Flashcard } from './flashcard';
import type { WordWithProgress } from '@/types/word';

vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: {
      quiz: {
        tapToReveal: 'Tap to reveal',
        again: 'Again',
        hard: 'Hard',
        good: 'Good',
        easy: 'Easy',
      },
      wordDetail: {
        markMastered: 'Master',
      },
    },
  }),
}));

vi.mock('@/lib/styles', () => ({
  bottomSep: 'border-t',
}));

const baseWord: WordWithProgress = {
  id: 'w1',
  term: '食べる',
  reading: 'たべる',
  meaning: 'to eat',
  notes: 'ichidan verb',
  tags: [],
  jlptLevel: 5,
  priority: 0,
  mastered: false,
  masteredAt: null,
  isLeech: false,
  leechAt: null,
  isOwned: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  progress: null,
};

describe('Flashcard', () => {
  const onRate = vi.fn();
  const onMaster = vi.fn();
  const progress = { current: 3, total: 10 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state with disabled buttons', () => {
    render(
      <Flashcard
        isLoading
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
    expect(screen.getByText('Again')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
  });

  it('renders nothing when word is undefined and not loading', () => {
    const { container } = render(
      <Flashcard
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows front text (term) and tap-to-reveal hint in term_first mode', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    expect(screen.getByText('食べる')).toBeInTheDocument();
    expect(screen.getByText('Tap to reveal')).toBeInTheDocument();
    expect(screen.queryByText('to eat')).not.toBeInTheDocument();
  });

  it('shows front text (meaning) in meaning_first mode', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="meaning_first"
      />,
    );

    expect(screen.getByText('to eat')).toBeInTheDocument();
    expect(screen.getByText('Tap to reveal')).toBeInTheDocument();
    expect(screen.queryByText('食べる')).not.toBeInTheDocument();
  });

  it('reveals back content on tap', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));

    expect(screen.getByText('to eat')).toBeInTheDocument();
    expect(screen.getByText('たべる')).toBeInTheDocument();
    expect(screen.getByText('ichidan verb')).toBeInTheDocument();
    expect(screen.queryByText('Tap to reveal')).not.toBeInTheDocument();
  });

  it('does not show reading when word has no reading', () => {
    const wordNoReading = { ...baseWord, reading: '' };

    render(
      <Flashcard
        word={wordNoReading}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));

    expect(screen.getByText('to eat')).toBeInTheDocument();
    expect(screen.queryByText('たべる')).not.toBeInTheDocument();
  });

  it('does not show notes when word has no notes', () => {
    const wordNoNotes = { ...baseWord, notes: null };

    render(
      <Flashcard
        word={wordNoNotes}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));

    expect(screen.getByText('to eat')).toBeInTheDocument();
    expect(screen.queryByText('ichidan verb')).not.toBeInTheDocument();
  });

  it('calls onRate(0) and resets card on "Again" click', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    // Reveal first
    fireEvent.click(screen.getByTestId('flashcard'));
    expect(screen.getByText('to eat')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('flashcard-rate-0'));

    expect(onRate).toHaveBeenCalledWith(0);
    // Card should reset (onAdvance resets revealed state)
    expect(screen.getByText('Tap to reveal')).toBeInTheDocument();
  });

  it('calls onRate(3) on "Hard" click after reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('flashcard-rate-3'));

    expect(onRate).toHaveBeenCalledWith(3);
  });

  it('calls onRate(4) on "Good" click after reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('flashcard-rate-4'));

    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('calls onRate(5) on "Easy" click after reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('flashcard-rate-5'));

    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('calls onMaster on "Master" click after reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));
    fireEvent.click(screen.getByTestId('flashcard-rate-master'));

    expect(onMaster).toHaveBeenCalledOnce();
  });

  it('toggles reveal on double tap (hide back content)', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
        cardDirection="term_first"
      />,
    );

    const card = screen.getByTestId('flashcard');

    // First tap: reveal
    fireEvent.click(card);
    expect(screen.getByText('to eat')).toBeInTheDocument();

    // Second tap: hide
    fireEvent.click(card);
    expect(screen.getByText('Tap to reveal')).toBeInTheDocument();
    expect(screen.queryByText('to eat')).not.toBeInTheDocument();
  });

  it('renders all four rating buttons with correct test ids', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    expect(screen.getByTestId('flashcard-rate-0')).toBeInTheDocument();
    expect(screen.getByTestId('flashcard-rate-3')).toBeInTheDocument();
    expect(screen.getByTestId('flashcard-rate-4')).toBeInTheDocument();
    expect(screen.getByTestId('flashcard-rate-5')).toBeInTheDocument();
    expect(screen.getByTestId('flashcard-rate-master')).toBeInTheDocument();
    expect(screen.getByTestId('flashcard-rating')).toBeInTheDocument();
  });

  it('rating buttons are disabled before reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    expect(screen.getByTestId('flashcard-rate-0')).toBeDisabled();
    expect(screen.getByTestId('flashcard-rate-3')).toBeDisabled();
    expect(screen.getByTestId('flashcard-rate-4')).toBeDisabled();
    expect(screen.getByTestId('flashcard-rate-5')).toBeDisabled();
    expect(screen.getByTestId('flashcard-rate-master')).toBeDisabled();
  });

  it('rating buttons are enabled after reveal', () => {
    render(
      <Flashcard
        word={baseWord}
        onRate={onRate}
        onMaster={onMaster}
        progress={progress}
      />,
    );

    fireEvent.click(screen.getByTestId('flashcard'));

    expect(screen.getByTestId('flashcard-rate-0')).toBeEnabled();
    expect(screen.getByTestId('flashcard-rate-3')).toBeEnabled();
    expect(screen.getByTestId('flashcard-rate-4')).toBeEnabled();
    expect(screen.getByTestId('flashcard-rate-5')).toBeEnabled();
    expect(screen.getByTestId('flashcard-rate-master')).toBeEnabled();
  });
});
