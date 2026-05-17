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
