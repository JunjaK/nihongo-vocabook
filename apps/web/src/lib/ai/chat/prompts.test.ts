import { describe, it, expect } from 'vitest';
import { baseSystemPrompt, buildSystemPrompt } from './prompts';
import type { Word } from '@/types/word';
import type { Wordbook, WordbookWithCount } from '@/types/wordbook';
import type { DataRepository } from '@/lib/repository/types';

describe('baseSystemPrompt', () => {
  it('mentions the 漢字(かな) format requirement (ko)', () => {
    const p = baseSystemPrompt('ko');
    expect(p).toContain('漢字(かな)');
  });

  it('forbids inventing word/wordbook IDs', () => {
    const p = baseSystemPrompt('ko');
    expect(p).toContain('Never invent word/wordbook IDs');
  });

  it('directs plain-text answers for meaning questions', () => {
    const p = baseSystemPrompt('ko');
    expect(p.toLowerCase()).toContain('no tool call');
  });

  it('English variant exists and uses English example sentence', () => {
    const p = baseSystemPrompt('en');
    expect(p).toContain('Reply in English');
  });
});

function fakeWord(): Word {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    dictionaryEntryId: 'd',
    term: '桜',
    reading: 'さくら',
    meaning: '벚꽃',
    jlptLevel: 5,
    mastered: false,
    notes: null,
    tags: [],
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Word;
}

function fakeRepo(words: Word[] = [], wordbook?: Wordbook | WordbookWithCount): DataRepository {
  return {
    words: {
      getById: async (id: string) => words.find((w) => w.id === id) ?? null,
    } as never,
    wordbooks: {
      getAll: async () => (wordbook ? [wordbook] : []),
      getWordbooksForWord: async () => (wordbook ? [wordbook] : []),
      getWordsPaginated: async () => ({ words, totalCount: words.length }),
    } as never,
    chat: {} as never,
    study: {} as never,
    exportAll: (async () => ({}) ) as never,
  } as unknown as DataRepository;
}

describe('buildSystemPrompt — quiz scope', () => {
  it('contains the rating-tone block with all four ratings', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', sessionId: 'test', currentWordId: word.id, lastRating: 1 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toMatch(/again/i);
    expect(p).toMatch(/hard/i);
    expect(p).toMatch(/good/i);
    expect(p).toMatch(/easy/i);
  });

  it('forbids tool calls in quiz scope', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', sessionId: 'test', currentWordId: word.id, lastRating: 3 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('NO tool calls');
  });

  it('uses the shortened id in the card line', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', sessionId: 'test', currentWordId: word.id, lastRating: 3 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('id: 550e8400');
    expect(p).not.toContain(word.id); // full UUID should not appear
  });
});

describe('buildSystemPrompt — word scope', () => {
  it('focuses on the single word', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'word', wordId: word.id },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('Your focus is this word and nothing else');
  });
});

describe('buildSystemPrompt — wordbook scope', () => {
  it('caps the sample at 20 words', async () => {
    const words: Word[] = Array.from({ length: 25 }, (_, i) => ({
      ...fakeWord(),
      id: `id-${i}`.padEnd(36, '0'),
      term: `単語${i}`,
    }));
    const wb = {
      id: 'wb-1234'.padEnd(36, '0'),
      name: 'JLPT N3',
      description: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      wordCount: 25,
      importCount: 0,
      masteredCount: 0,
    } as unknown as WordbookWithCount;
    const p = await buildSystemPrompt(
      { kind: 'wordbook', wordbookId: wb.id },
      fakeRepo(words, wb),
      'ko',
    );
    expect(p).toContain('sample (first 20 of 25)');
    expect(p).not.toContain('単語24');
  });
});

import { getBudget, trimHistoryToBudget } from './prompts';

describe('getBudget', () => {
  it('returns conservative reserves on the 2K bucket', () => {
    expect(getBudget(2048)).toEqual({
      total: 2048,
      reservedForOutput: 600,
      reservedForNextUser: 200,
    });
  });

  it('scales output reserve to 1024 on the 8K bucket', () => {
    expect(getBudget(8192)).toEqual({
      total: 8192,
      reservedForOutput: 1024,
      reservedForNextUser: 400,
    });
  });

  it('caps output reserve at 2048 on the 32K bucket', () => {
    expect(getBudget(32768)).toEqual({
      total: 32768,
      reservedForOutput: 2048,
      reservedForNextUser: 400,
    });
  });

  it('falls back to the 2K bucket on undefined input', () => {
    expect(getBudget(undefined)).toEqual({
      total: 2048,
      reservedForOutput: 600,
      reservedForNextUser: 200,
    });
  });
});

describe('trimHistoryToBudget — pair preservation', () => {
  // Helper: a message of `chars` text characters in the text block.
  function msg(role: 'user' | 'assistant' | 'tool', chars: number) {
    return {
      role,
      content: [{ type: 'text' as const, text: 'x'.repeat(chars) }],
    };
  }

  it('drops in turn groups, never orphans a user from its assistant', () => {
    const history = [
      msg('user', 400),
      msg('assistant', 400),
      msg('user', 400),
      msg('assistant', 400),
      msg('user', 400),
      msg('assistant', 400),
    ];
    const budget = { total: 2048, reservedForOutput: 600, reservedForNextUser: 200 };
    const { kept, truncated } = trimHistoryToBudget(
      /* system — large enough to consume most of the budget */ 'x'.repeat(748 * 4),
      /* toolsJson */ '[]',
      history,
      budget,
    );
    expect(truncated).toBe(true);
    // kept length must be even — pairs only.
    expect(kept.length % 2).toBe(0);
    // First kept message must be a user role (the start of a turn).
    if (kept.length > 0) {
      expect(kept[0].role).toBe('user');
    }
  });

  it('keeps everything when the budget is large enough', () => {
    const history = [msg('user', 50), msg('assistant', 50)];
    const budget = { total: 32768, reservedForOutput: 2048, reservedForNextUser: 400 };
    const { kept, truncated } = trimHistoryToBudget('x', '[]', history, budget);
    expect(truncated).toBe(false);
    expect(kept).toHaveLength(2);
  });
});
