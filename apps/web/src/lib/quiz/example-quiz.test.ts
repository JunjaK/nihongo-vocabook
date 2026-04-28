import { describe, it, expect } from 'vitest';
import { findMaskTarget, maskSentence, buildExampleCard } from './example-quiz';
import type { Word, WordExample, WordWithProgress } from '@/types/word';

function makeWord(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    dictionaryEntryId: 'd1',
    term: '食べる',
    reading: 'たべる',
    meaning: 'to eat',
    notes: null,
    tags: [],
    jlptLevel: 3,
    priority: 2,
    mastered: false,
    masteredAt: null,
    isLeech: false,
    leechAt: null,
    isOwned: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWordWithProgress(overrides: Partial<WordWithProgress> = {}): WordWithProgress {
  return { ...makeWord(), progress: null, ...overrides };
}

function makeExample(sentenceJa: string, id = 'e1'): WordExample {
  return {
    id,
    dictionaryEntryId: 'd1',
    sentenceJa,
    sentenceReading: null,
    sentenceMeaning: null,
    source: 'claude',
    createdAt: new Date(),
  };
}

describe('findMaskTarget', () => {
  it('returns the term verbatim when sentence contains it directly', () => {
    expect(findMaskTarget('学校に行く', '学校')).toBe('学校');
    expect(findMaskTarget('食べるのが好き', '食べる')).toBe('食べる');
  });

  it('strips trailing る from godan verbs to find the kanji prefix', () => {
    expect(findMaskTarget('走りなさい', '走る')).toBe('走');
    expect(findMaskTarget('走った', '走る')).toBe('走');
    expect(findMaskTarget('走ります', '走る')).toBe('走');
  });

  it('strips trailing る from ichidan verbs preserving the kana stem', () => {
    expect(findMaskTarget('食べました', '食べる')).toBe('食べ');
    expect(findMaskTarget('食べて', '食べる')).toBe('食べ');
  });

  it('strips trailing い from i-adjectives', () => {
    expect(findMaskTarget('大きく見える', '大きい')).toBe('大き');
    expect(findMaskTarget('大きかった', '大きい')).toBe('大き');
  });

  it('strips trailing だ from na-adjectives', () => {
    expect(findMaskTarget('静かな部屋', '静かだ')).toBe('静か');
    expect(findMaskTarget('静かに歩く', '静かだ')).toBe('静か');
  });

  it('returns null for pure-kana terms with no kanji to anchor on', () => {
    expect(findMaskTarget('します', 'する')).toBeNull();
    expect(findMaskTarget('できました', 'できる')).toBeNull();
    expect(findMaskTarget('あげました', 'あげる')).toBeNull();
  });

  it('returns null when sentence does not contain the term or its kanji prefix', () => {
    expect(findMaskTarget('全然違う文章', '走る')).toBeNull();
    expect(findMaskTarget('猫が好き', '食べる')).toBeNull();
  });

  it('returns null for empty inputs', () => {
    expect(findMaskTarget('', '走る')).toBeNull();
    expect(findMaskTarget('走った', '')).toBeNull();
  });
});

describe('maskSentence', () => {
  it('replaces the dictionary form when present', () => {
    expect(maskSentence('食べるのが好き', '食べる')).toBe('____のが好き');
  });

  it('replaces the kanji prefix when verb is conjugated', () => {
    expect(maskSentence('走りなさい', '走る')).toBe('____りなさい');
    expect(maskSentence('食べました', '食べる')).toBe('____ました');
  });

  it('replaces all occurrences of the target', () => {
    expect(maskSentence('走って走った', '走る')).toBe('____って____った');
  });

  it('returns sentence unchanged when no safe target exists', () => {
    expect(maskSentence('します', 'する')).toBe('します');
    expect(maskSentence('全然違う文章', '走る')).toBe('全然違う文章');
  });
});

describe('buildExampleCard', () => {
  const distractorPool: Word[] = [
    makeWord({ id: 'd1w', term: '飲む', jlptLevel: 3 }),
    makeWord({ id: 'd2w', term: '見る', jlptLevel: 3 }),
    makeWord({ id: 'd3w', term: '買う', jlptLevel: 3 }),
  ];

  it('builds a card with maskTarget when an inflected example matches', () => {
    const word = makeWordWithProgress({ id: 'wA', term: '走る', jlptLevel: 3 });
    const examples = [makeExample('走りなさい')];
    const card = buildExampleCard(word, examples, [
      ...distractorPool,
      makeWord({ id: 'wA', term: '走る' }),
    ]);
    expect(card).not.toBeNull();
    if (card?.kind !== 'example') throw new Error('expected example card');
    expect(card.maskTarget).toBe('走');
    expect(card.distractors).toHaveLength(2);
  });

  it('returns null when no example contains a maskable form', () => {
    const word = makeWordWithProgress({ id: 'wA', term: 'する' });
    const examples = [makeExample('します'), makeExample('しました')];
    const card = buildExampleCard(word, examples, distractorPool);
    expect(card).toBeNull();
  });

  it('returns null when fewer than 2 distractors are available', () => {
    const word = makeWordWithProgress({ id: 'wA', term: '走る' });
    const examples = [makeExample('走った')];
    const card = buildExampleCard(word, examples, [
      makeWord({ id: 'd1w', term: '飲む' }),
    ]);
    expect(card).toBeNull();
  });

  it('dedupes distractors by term so no two choices share the same surface form', () => {
    const word = makeWordWithProgress({ id: 'wA', term: '走る', jlptLevel: 3 });
    const examples = [makeExample('走った')];
    // Pool with many duplicates of "見る" — naive picking would produce duplicates.
    const dupPool: Word[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeWord({ id: `dup${i}`, term: '見る', jlptLevel: 3 }),
      ),
      makeWord({ id: 'unique', term: '飲む', jlptLevel: 3 }),
    ];
    for (let i = 0; i < 50; i += 1) {
      const card = buildExampleCard(word, examples, dupPool);
      expect(card).not.toBeNull();
      if (card?.kind !== 'example') throw new Error('expected example card');
      const terms = new Set([word.term, card.distractors[0].term, card.distractors[1].term]);
      expect(terms.size).toBe(3);
    }
  });

  it('excludes distractors whose term equals the correct term', () => {
    const word = makeWordWithProgress({ id: 'wA', term: '走る', jlptLevel: 3 });
    const examples = [makeExample('走った')];
    const pool: Word[] = [
      makeWord({ id: 'sameTermDifferentId', term: '走る', jlptLevel: 3 }),
      makeWord({ id: 'd1w', term: '飲む', jlptLevel: 3 }),
      makeWord({ id: 'd2w', term: '見る', jlptLevel: 3 }),
    ];
    for (let i = 0; i < 20; i += 1) {
      const card = buildExampleCard(word, examples, pool);
      if (card?.kind !== 'example') throw new Error('expected example card');
      expect(card.distractors[0].term).not.toBe('走る');
      expect(card.distractors[1].term).not.toBe('走る');
    }
  });
});
