import { describe, it, expect } from 'vitest';
import { sanitizeIlikeQuery, quotePostgrestValue } from './postgrest-safe';

describe('sanitizeIlikeQuery', () => {
  it('keeps innocuous Japanese/Korean/English chars untouched', () => {
    expect(sanitizeIlikeQuery('コーヒー')).toBe('コーヒー');
    expect(sanitizeIlikeQuery('단어')).toBe('단어');
    expect(sanitizeIlikeQuery('hello world')).toBe('hello world');
  });

  it('strips PostgREST filter separators that could escape the value', () => {
    expect(sanitizeIlikeQuery('foo,bar')).toBe('foobar');
    expect(sanitizeIlikeQuery('a(b)c')).toBe('abc');
    expect(sanitizeIlikeQuery('a:b')).toBe('ab');
  });

  it('strips SQL LIKE wildcards so users cannot match everything', () => {
    expect(sanitizeIlikeQuery('%foo%')).toBe('foo');
    expect(sanitizeIlikeQuery('a_b')).toBe('ab');
    expect(sanitizeIlikeQuery('*x*')).toBe('x');
  });

  it('strips quotes and backslashes', () => {
    expect(sanitizeIlikeQuery('a"b\\c')).toBe('abc');
  });

  it('caps length to prevent megabyte-query DOS', () => {
    expect(sanitizeIlikeQuery('a'.repeat(500))).toHaveLength(100);
    expect(sanitizeIlikeQuery('a'.repeat(50), 20)).toHaveLength(20);
  });

  it('returns empty string for input that degenerates to nothing', () => {
    expect(sanitizeIlikeQuery(',,()')).toBe('');
    expect(sanitizeIlikeQuery('   ')).toBe('');
  });
});

describe('quotePostgrestValue', () => {
  it('wraps the value in double quotes', () => {
    expect(quotePostgrestValue('foo')).toBe('"foo"');
  });

  it('escapes embedded double quotes', () => {
    expect(quotePostgrestValue('a"b')).toBe('"a\\"b"');
  });

  it('escapes backslashes before double-quote escapes (order matters)', () => {
    // input \" should become \\\" — so the wire form is "\\\"" not """ (which
    // would close the value prematurely).
    expect(quotePostgrestValue('\\"')).toBe('"\\\\\\""');
  });

  it('preserves commas, parens, colons inside the quoted value', () => {
    // These are the chars an attacker would use to break out of an unquoted
    // in-list — quoting must keep them literal, not strip them.
    expect(quotePostgrestValue('a,b')).toBe('"a,b"');
    expect(quotePostgrestValue('a(b)')).toBe('"a(b)"');
    expect(quotePostgrestValue('a:b')).toBe('"a:b"');
  });

  it('caps length', () => {
    expect(quotePostgrestValue('a'.repeat(500))).toHaveLength(102); // 100 + 2 quotes
  });
});
