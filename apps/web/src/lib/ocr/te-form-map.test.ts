import { describe, expect, it } from 'vitest';
import { __TE_TA_BASE_MAP_FOR_TESTS, lookupTeFormBase } from './te-form-map';

describe('lookupTeFormBase', () => {
  it('returns null for unmapped raw input', () => {
    expect(lookupTeFormBase('食べる')).toBeNull();
    expect(lookupTeFormBase('適当な単語')).toBeNull();
    expect(lookupTeFormBase('')).toBeNull();
  });

  it('maps godan -く verbs to base form via te/ta', () => {
    expect(lookupTeFormBase('書いて')).toBe('書く');
    expect(lookupTeFormBase('書いた')).toBe('書く');
    expect(lookupTeFormBase('聞いて')).toBe('聞く');
    expect(lookupTeFormBase('歩いた')).toBe('歩く');
  });

  it('maps godan -ぐ verbs (いで/いだ)', () => {
    expect(lookupTeFormBase('泳いで')).toBe('泳ぐ');
    expect(lookupTeFormBase('急いだ')).toBe('急ぐ');
  });

  it('maps godan -す verbs (して/した)', () => {
    expect(lookupTeFormBase('話して')).toBe('話す');
    expect(lookupTeFormBase('出した')).toBe('出す');
    expect(lookupTeFormBase('消して')).toBe('消す');
  });

  it('maps godan -つ/-う/-る verbs (って/った)', () => {
    expect(lookupTeFormBase('待って')).toBe('待つ');
    expect(lookupTeFormBase('持った')).toBe('持つ');
    expect(lookupTeFormBase('買って')).toBe('買う');
    expect(lookupTeFormBase('会った')).toBe('会う');
    expect(lookupTeFormBase('取って')).toBe('取る');
    expect(lookupTeFormBase('作った')).toBe('作る');
  });

  it('maps godan -ぬ/-ぶ/-む verbs (んで/んだ)', () => {
    expect(lookupTeFormBase('死んで')).toBe('死ぬ');
    expect(lookupTeFormBase('遊んで')).toBe('遊ぶ');
    expect(lookupTeFormBase('呼んだ')).toBe('呼ぶ');
    expect(lookupTeFormBase('読んで')).toBe('読む');
    expect(lookupTeFormBase('飲んだ')).toBe('飲む');
  });

  it('maps godan -る (e-row) verbs that look like ichidan but conjugate godan', () => {
    expect(lookupTeFormBase('帰って')).toBe('帰る');
    expect(lookupTeFormBase('走った')).toBe('走る');
    expect(lookupTeFormBase('切って')).toBe('切る');
    expect(lookupTeFormBase('知った')).toBe('知る');
    expect(lookupTeFormBase('入って')).toBe('入る');
  });

  it('handles irregular te/ta-forms (行く / 来る / する)', () => {
    expect(lookupTeFormBase('行って')).toBe('行く');
    expect(lookupTeFormBase('行った')).toBe('行く');
    expect(lookupTeFormBase('いって')).toBe('行く');
    expect(lookupTeFormBase('来て')).toBe('来る');
    expect(lookupTeFormBase('来た')).toBe('来る');
    expect(lookupTeFormBase('して')).toBe('する');
    expect(lookupTeFormBase('した')).toBe('する');
  });

  it('handles stacked te-iru family (ている / ています / ていた / ていました)', () => {
    expect(lookupTeFormBase('書いている')).toBe('書く');
    expect(lookupTeFormBase('書いています')).toBe('書く');
    expect(lookupTeFormBase('読んでいる')).toBe('読む');
    expect(lookupTeFormBase('読んでいた')).toBe('読む');
    expect(lookupTeFormBase('待っています')).toBe('待つ');
    expect(lookupTeFormBase('話していました')).toBe('話す');
  });

  it('handles te-kudasai (~てください)', () => {
    expect(lookupTeFormBase('書いてください')).toBe('書く');
    expect(lookupTeFormBase('読んでください')).toBe('読む');
    expect(lookupTeFormBase('待ってください')).toBe('待つ');
  });

  it('NFKC-normalizes raw input (full-width digit drift defense)', () => {
    // Already half-width — should still match; this asserts normalize is wired
    expect(lookupTeFormBase('書いて'.normalize('NFKC'))).toBe('書く');
  });

  it('map contains expected entry count guard (sanity)', () => {
    // Catch accidental empty / explosion. Adjust if expanding the curated list.
    expect(__TE_TA_BASE_MAP_FOR_TESTS.size).toBeGreaterThan(400);
    expect(__TE_TA_BASE_MAP_FOR_TESTS.size).toBeLessThan(1000);
  });
});
