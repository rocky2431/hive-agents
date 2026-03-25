import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatRelative, formatNumber } from './date.ts';

describe('formatDate', () => {
  it('returns dash for null/undefined', () => {
    assert.strictEqual(formatDate(null), '-');
    assert.strictEqual(formatDate(undefined), '-');
  });

  it('formats a valid ISO string', () => {
    const result = formatDate('2026-03-25T10:00:00Z');
    assert.ok(result.includes('2026'), `Expected year in "${result}"`);
    assert.ok(result.includes('25'), `Expected day in "${result}"`);
  });

  it('formats a Date object', () => {
    const result = formatDate(new Date('2026-01-15'));
    assert.ok(result.includes('2026'));
    assert.ok(result.includes('15'));
  });

  it('returns dash for invalid date strings', () => {
    assert.strictEqual(formatDate('not-a-date'), '-');
    assert.strictEqual(formatDate(''), '-');
  });
});

describe('formatDateTime', () => {
  it('returns dash for null', () => {
    assert.strictEqual(formatDateTime(null), '-');
  });

  it('includes year in output', () => {
    const result = formatDateTime('2026-03-25T14:30:00Z');
    assert.ok(result.includes('2026'));
  });
});

describe('formatRelative', () => {
  it('returns dash for null/undefined', () => {
    assert.strictEqual(formatRelative(null), '-');
    assert.strictEqual(formatRelative(undefined), '-');
  });

  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    assert.strictEqual(formatRelative(now), 'just now');
  });

  it('returns minutes ago for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = formatRelative(fiveMinAgo);
    assert.ok(result.includes('5') || result.includes('minute'), `Expected relative minutes in "${result}"`);
  });

  it('returns hours ago for hours past', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = formatRelative(threeHoursAgo);
    assert.ok(result.includes('3') || result.includes('hour'), `Expected relative hours in "${result}"`);
  });

  it('falls back to date for old timestamps', () => {
    const result = formatRelative('2020-01-01T00:00:00Z');
    assert.ok(result.includes('2020'), `Expected year fallback in "${result}"`);
  });

  it('falls back to absolute date for future timestamps', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelative(future);
    assert.ok(result !== '-' && result !== 'just now', `Expected absolute date for future, got "${result}"`);
  });

  it('returns dash for invalid date strings', () => {
    assert.strictEqual(formatRelative('garbage'), '-');
  });
});

describe('formatNumber', () => {
  it('returns 0 for null/undefined', () => {
    assert.strictEqual(formatNumber(null), '0');
    assert.strictEqual(formatNumber(undefined), '0');
  });

  it('formats small numbers', () => {
    assert.strictEqual(formatNumber(42), '42');
  });

  it('adds grouping separators for large numbers', () => {
    const result = formatNumber(1234567);
    // Different locales use different separators, just verify it's longer than plain digits
    assert.ok(result.length > 7, `Expected separators in "${result}"`);
  });
});
