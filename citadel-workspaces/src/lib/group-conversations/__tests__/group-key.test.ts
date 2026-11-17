import { describe, it, expect } from 'vitest';
import { groupKeyToId, groupIdToKey, isValidGroupId, parseGroupKey } from '../group-key';

describe('group key encoding', () => {
  it('round-trips a key through its id', () => {
    const key: { cid: bigint; mgid: bigint; } = { cid: 12345678901234567890n, mgid: 98765432109876543210n };

    expect(groupIdToKey(groupKeyToId(key))).toEqual(key);
  });

  it('survives an mgid far beyond Number.MAX_SAFE_INTEGER', () => {
    // mgid is u128 on the backend; going through a JS number would silently
    // corrupt it, which is why both halves stay bigint.
    const mgid: bigint = 340282366920938463463374607431768211455n;
    const id: string = groupKeyToId({ cid: 1n, mgid });

    expect(groupIdToKey(id).mgid).toBe(mgid);
  });

  it('produces an id usable in a route path and as a map key', () => {
    expect(groupKeyToId({ cid: 7n, mgid: 9n })).toBe('7:9');
  });

  it.each([
    ['', 'empty'],
    ['7', 'no separator'],
    ['7:9:11', 'too many parts'],
    ['a:9', 'non-numeric cid'],
    ['7:b', 'non-numeric mgid'],
    ['-7:9', 'negative cid'],
    ['7.5:9', 'decimal cid'],
  ])('rejects %s (%s) rather than guessing', (bad: string, _why: string) => {
    expect(() => groupIdToKey(bad)).toThrow(/Malformed group id/);
    expect(isValidGroupId(bad)).toBe(false);
  });

  it('accepts a wire key whose numbers arrived as strings', () => {
    expect(parseGroupKey({ cid: '5', mgid: '6' })).toEqual({ cid: 5n, mgid: 6n });
  });

  it('accepts a wire key that arrived as bigints', () => {
    expect(parseGroupKey({ cid: 5n, mgid: 6n })).toEqual({ cid: 5n, mgid: 6n });
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    ['7:9', 'a string instead of an object'],
    [{ cid: 1n }, 'a missing mgid'],
  ])('refuses %s (%s)', (bad: unknown, _why: string) => {
    expect(() => parseGroupKey(bad)).toThrow();
  });
});
