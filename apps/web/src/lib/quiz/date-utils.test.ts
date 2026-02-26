import { describe, it, expect } from 'vitest';
import { getLocalDateString, getPreviousDateString } from './date-utils';

describe('getLocalDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = getLocalDateString(new Date('2025-03-15T10:00:00'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns correct date for given Date object', () => {
    const date = new Date(2025, 0, 5); // Jan 5 2025 in local time
    const result = getLocalDateString(date);
    expect(result).toBe('2025-01-05');
  });

  it('pads single-digit month and day', () => {
    const date = new Date(2025, 2, 3); // Mar 3
    const result = getLocalDateString(date);
    expect(result).toBe('2025-03-03');
  });

  it('returns today when called without arguments', () => {
    const result = getLocalDateString();
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

describe('getPreviousDateString', () => {
  it('returns the day before', () => {
    expect(getPreviousDateString('2025-03-15')).toBe('2025-03-14');
  });

  it('handles month boundary', () => {
    expect(getPreviousDateString('2025-03-01')).toBe('2025-02-28');
  });

  it('handles year boundary', () => {
    expect(getPreviousDateString('2025-01-01')).toBe('2024-12-31');
  });

  it('handles leap year', () => {
    expect(getPreviousDateString('2024-03-01')).toBe('2024-02-29');
  });
});
