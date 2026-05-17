import { describe, it, expect } from 'vitest';
import { TOOLS, SCOPE_TOOL_ALLOWLIST, getTool, getToolDefsForBridge, emptyIdTable } from './tools';
import type { DataRepository } from '@/lib/repository/types';
import type { ChatScope } from '@/types/chat';

describe('TOOLS catalog', () => {
  it('contains the 12 tools from the spec', () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      [
        'add_word',
        'add_word_to_wordbook',
        'create_wordbook',
        'delete_word',
        'delete_wordbook',
        'edit_word',
        'edit_wordbook',
        'extract_words_from_image',
        'generate_example_sentence',
        'remove_word_from_wordbook',
        'search_words',
        'set_mastered',
      ].sort(),
    );
  });

  it('every mutating tool has confirm-card description copy', () => {
    for (const tool of Object.values(TOOLS)) {
      if (tool.mutates) {
        const label = tool.describeAction({});
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('every tool exposes a JSON Schema parameter object', () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('search_words is non-mutating', () => {
    expect(TOOLS.search_words.mutates).toBe(false);
  });

  it('does not expose find_similar — removed in 2026-05-17 redesign', () => {
    expect(Object.keys(TOOLS)).not.toContain('find_similar');
  });

  it('add_word / edit_word / delete_word are mutating', () => {
    expect(TOOLS.add_word.mutates).toBe(true);
    expect(TOOLS.edit_word.mutates).toBe(true);
    expect(TOOLS.delete_word.mutates).toBe(true);
  });

  it('wordbook CRUD are all mutating', () => {
    expect(TOOLS.create_wordbook.mutates).toBe(true);
    expect(TOOLS.edit_wordbook.mutates).toBe(true);
    expect(TOOLS.delete_wordbook.mutates).toBe(true);
    expect(TOOLS.add_word_to_wordbook.mutates).toBe(true);
    expect(TOOLS.remove_word_from_wordbook.mutates).toBe(true);
  });

  it('edit_word does NOT accept a `term` parameter', () => {
    // Repository contract excludes term from UpdateWordInput. The tool schema
    // mirrors that — changing kanji form requires delete + re-add.
    const params = TOOLS.edit_word.parameters as { properties?: Record<string, unknown> };
    expect(params.properties?.term).toBeUndefined();
  });
});

describe('getTool', () => {
  it('returns the tool definition for a known name', () => {
    const t = getTool('add_word');
    expect(t).not.toBeNull();
    expect(t?.name).toBe('add_word');
  });

  it('returns null for an unknown name (model invented one)', () => {
    expect(getTool('hallucinated_tool')).toBeNull();
  });
});

describe('getToolDefsForBridge', () => {
  it('returns one entry per catalog tool', () => {
    const defs = getToolDefsForBridge({ kind: 'general' });
    expect(defs).toHaveLength(Object.keys(TOOLS).length);
  });

  it('strips execute/mutates/describeAction (wire format only)', () => {
    const defs = getToolDefsForBridge({ kind: 'general' });
    for (const d of defs) {
      expect(Object.keys(d).sort()).toEqual(['description', 'name', 'parameters']);
    }
  });
});

describe('getToolDefsForBridge(scope)', () => {
  it('returns all 12 tools for general scope', () => {
    const defs = getToolDefsForBridge({ kind: 'general' });
    expect(defs).toHaveLength(12);
  });

  it('returns exactly 3 tools for quiz scope', () => {
    const defs = getToolDefsForBridge({
      kind: 'quiz',
      sessionId: 'test-session',
      currentWordId: 'x',
      lastRating: 3,
    });
    expect(defs.map((d) => d.name).sort()).toEqual(
      ['generate_example_sentence', 'search_words', 'set_mastered'],
    );
  });

  it('returns exactly 6 tools for word scope', () => {
    const defs = getToolDefsForBridge({ kind: 'word', wordId: 'x' });
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        'add_word_to_wordbook',
        'edit_word',
        'generate_example_sentence',
        'remove_word_from_wordbook',
        'search_words',
        'set_mastered',
      ],
    );
  });

  it('returns exactly 4 tools for wordbook scope', () => {
    const defs = getToolDefsForBridge({ kind: 'wordbook', wordbookId: 'x' });
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        'add_word_to_wordbook',
        'edit_wordbook',
        'remove_word_from_wordbook',
        'search_words',
      ],
    );
  });

  it('every allowlist entry refers to a real tool', () => {
    const allKnown = new Set(Object.keys(TOOLS));
    for (const [scope, names] of Object.entries(SCOPE_TOOL_ALLOWLIST)) {
      for (const name of names) {
        expect(allKnown, `${scope}: '${name}' not in TOOLS`).toContain(name);
      }
    }
  });
});

describe('TOOLS iteration order', () => {
  it('starts with read-only tools', () => {
    const names = Object.keys(TOOLS);
    expect(names[0]).toBe('search_words');
    expect(names[1]).toBe('extract_words_from_image');
  });

  it('ends with destructive tools', () => {
    const names = Object.keys(TOOLS);
    expect(names[names.length - 2]).toBe('delete_word');
    expect(names[names.length - 1]).toBe('delete_wordbook');
  });
});

describe('idTable resolution in execute', () => {
  const FULL_UUID = '550e8400-e29b-41d4-a716-446655440000';
  const SHORT = '550e8400';

  interface TestRepoStub {
    words: {
      delete?: (id: string) => Promise<{ ok: boolean; id: string }>;
    };
  }

  function ctxWith(opts: { word?: [string, string][] } = {}) {
    const idTable = emptyIdTable();
    for (const [s, f] of opts.word ?? []) idTable.word.set(s, f);
    const repo: TestRepoStub = {
      words: { delete: async (id: string) => ({ ok: true, id }) },
    };
    return { repo: repo as unknown as DataRepository, locale: 'ko', idTable };
  }

  it('resolves a short wordId against the idTable', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith({ word: [[SHORT, FULL_UUID]] });
    let calledWith = '';
    (ctx.repo as unknown as TestRepoStub).words.delete = async (id: string) => {
      calledWith = id;
      return { ok: true, id };
    };
    await tool.execute({ wordId: SHORT }, ctx);
    expect(calledWith).toBe(FULL_UUID);
  });

  it('passes a 36-char wordId through unchanged', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith();
    let calledWith = '';
    (ctx.repo as unknown as TestRepoStub).words.delete = async (id: string) => {
      calledWith = id;
      return { ok: true, id };
    };
    await tool.execute({ wordId: FULL_UUID }, ctx);
    expect(calledWith).toBe(FULL_UUID);
  });

  it('throws a clear message when a short wordId is unknown', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith();
    await expect(tool.execute({ wordId: SHORT }, ctx)).rejects.toThrow(
      /Unknown wordId.*search_words/,
    );
  });
});
