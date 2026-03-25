import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cn } from './cn.ts';

describe('cn', () => {
  it('merges simple classes', () => {
    assert.strictEqual(cn('foo', 'bar'), 'foo bar');
  });

  it('handles conditional classes', () => {
    assert.strictEqual(cn('base', false && 'hidden', 'end'), 'base end');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    const result = cn('p-4', 'p-2');
    assert.strictEqual(result, 'p-2');
  });

  it('handles undefined and null', () => {
    assert.strictEqual(cn('a', undefined, null, 'b'), 'a b');
  });
});
