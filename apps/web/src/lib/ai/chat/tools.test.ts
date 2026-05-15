import { describe, it, expect } from 'vitest';
import { TOOLS, getTool, getToolDefsForBridge } from './tools';

describe('TOOLS catalog', () => {
  it('contains the 13 tools from the spec', () => {
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
        'find_similar',
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

  it('search_words and find_similar are non-mutating', () => {
    expect(TOOLS.search_words.mutates).toBe(false);
    expect(TOOLS.find_similar.mutates).toBe(false);
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
    const defs = getToolDefsForBridge();
    expect(defs).toHaveLength(Object.keys(TOOLS).length);
  });

  it('strips execute/mutates/describeAction (wire format only)', () => {
    const defs = getToolDefsForBridge();
    for (const d of defs) {
      expect(Object.keys(d).sort()).toEqual(['description', 'name', 'parameters']);
    }
  });
});
