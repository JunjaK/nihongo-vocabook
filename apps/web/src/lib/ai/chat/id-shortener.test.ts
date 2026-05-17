import { describe, it, expect } from 'vitest';
import { shortenId, ID_PREFIX_LEN } from './id-shortener';

describe('shortenId', () => {
  it('truncates a 36-char UUID to 8 chars', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(shortenId(uuid)).toBe('550e8400');
    expect(shortenId(uuid)).toHaveLength(8);
  });

  it('is idempotent on already-short ids', () => {
    expect(shortenId('short')).toBe('short');
  });

  it('truncates an exactly-9-char string to 8 chars', () => {
    expect(shortenId('exactly9c')).toBe('exactly9');
  });

  it('exposes ID_PREFIX_LEN === 8', () => {
    expect(ID_PREFIX_LEN).toBe(8);
  });
});
