import { describe, it, expect } from 'vitest';
import { tryParseCid, toCidKey } from '../cid-utils';

/**
 * Tests for `tryParseCid`. The function is the single source of
 * truth for "best-effort CID parsing that doesn't throw" — every
 * call site that previously had its own try/catch around
 * `BigInt(...)` should be funnelled through this helper, so any
 * change to the parsing contract lives in one place.
 *
 * Contract: a CID is a positive (non-zero) unsigned integer. The
 * parser accepts a plain decimal string (surrounding whitespace
 * trimmed) and returns the bigint; anything else — empty/whitespace,
 * non-decimal, fractional/scientific, zero, or negative — returns
 * `undefined`. (BigInt() alone is too lenient: `BigInt(' ')` is `0n`
 * and `BigInt('-1')` is `-1n`, which must not be treated as valid CIDs
 * used for routing / persisted sessions.)
 *
 * Anchors the WorkspaceView fallback path: when the URL contains a
 * malformed `channel=` param or session storage is corrupted,
 * `tryParseCid` returns `undefined` instead of throwing during
 * render — the component then falls back to the non-P2P workspace
 * view. Without these tests, a "fix" that re-throws on invalid
 * input would silently re-introduce the crash that motivated the
 * helper.
 */
describe('tryParseCid', () => {
  it('parses a valid numeric string into a bigint', () => {
    expect(tryParseCid('12345')).toBe(12345n);
  });

  it('parses a large numeric string that exceeds Number.MAX_SAFE_INTEGER', () => {
    // CIDs are u64-shaped and routinely exceed 2^53. The whole point
    // of the bigint type is that we don't lose precision here. u64::MAX
    // (2^64-1) is the largest valid CID and must parse.
    expect(tryParseCid('18446744073709551615')).toBe(18446744073709551615n);
  });

  it('rejects values above the u64 range', () => {
    // 2^64 and beyond can't be real CIDs.
    expect(tryParseCid('18446744073709551616')).toBeUndefined();
    expect(tryParseCid('99999999999999999999999999')).toBeUndefined();
  });

  it('rejects a pathologically long digit string without parsing it (DoS guard)', () => {
    // A crafted URL param / corrupted session could supply a huge all-digit
    // string. It must be rejected by the O(1) length bound, never handed to
    // BigInt() (which would synchronously allocate an arbitrary-precision
    // integer and freeze the tab). u64::MAX is 20 digits, so >20 is rejected.
    expect(tryParseCid('9'.repeat(100_000))).toBeUndefined();
    expect(tryParseCid('1'.repeat(21))).toBeUndefined();
  });

  it('rejects zero (not a valid CID)', () => {
    // 0 is a sentinel/invalid CID; `BigInt('0')` is `0n` but the parser
    // must not surface it as a usable CID.
    expect(tryParseCid('0')).toBeUndefined();
  });

  it('trims surrounding whitespace around a valid CID', () => {
    expect(tryParseCid('  12345  ')).toBe(12345n);
  });

  it('returns undefined for whitespace-only input', () => {
    // `BigInt(' ')` is `0n`; the parser must reject it, not return 0n.
    expect(tryParseCid('   ')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(tryParseCid(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(tryParseCid(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    // Empty-string input historically came from `params.get('channel')`
    // when the param was present but blank — `BigInt('')` returns 0n,
    // which would be wrong (0 is a sentinel CID elsewhere). The
    // explicit empty-string short-circuit avoids that confusion.
    expect(tryParseCid('')).toBeUndefined();
  });

  it('returns undefined for a non-numeric string instead of throwing', () => {
    expect(tryParseCid('not-a-number')).toBeUndefined();
    expect(tryParseCid('abc123')).toBeUndefined();
    expect(tryParseCid('123abc')).toBeUndefined();
  });

  it('returns undefined for fractional / scientific notation', () => {
    // BigInt() rejects these — pin the behaviour so a future
    // "parse leniently" change has to update this test deliberately.
    expect(tryParseCid('1.5')).toBeUndefined();
    expect(tryParseCid('1e10')).toBeUndefined();
  });

  it('rejects negative numbers (not a valid CID)', () => {
    // CIDs are unsigned. `BigInt('-1')` is `-1n`, but the parser enforces
    // the positive-integer contract and returns undefined.
    expect(tryParseCid('-1')).toBeUndefined();
  });
});

describe('toCidKey', () => {
  it('produces the full-precision decimal string for a bigint CID', () => {
    expect(toCidKey(7040934265064422768n)).toBe('7040934265064422768');
  });

  it('accepts the string and number forms a CID may arrive in', () => {
    expect(toCidKey('7040934265064422768')).toBe('7040934265064422768');
    expect(toCidKey(12345)).toBe('12345');
  });

  it('distinguishes CIDs that share their last 10 digits', () => {
    // The regression this function exists to prevent. The previous `normalizeCid`
    // compared only the last 10 digits, so these two distinct peers compared EQUAL
    // and a registration response could be matched to the wrong peer.
    const a: string = toCidKey(11111111111234567890n);
    const b: string = toCidKey(99999999991234567890n);
    expect(a).not.toBe(b);
    expect(a.slice(-10)).toBe(b.slice(-10)); // the collision the old code accepted
  });

  it('returns the empty string for absent or unusable values', () => {
    // '' is the documented "no match" sentinel, so callers never need a try/catch.
    expect(toCidKey(null)).toBe('');
    expect(toCidKey(undefined)).toBe('');
    expect(toCidKey('not-a-cid')).toBe('');
    expect(toCidKey('')).toBe('');
    expect(toCidKey(0n)).toBe('');
    expect(toCidKey(-1n)).toBe('');
  });

  it('collapses every unusable value to the same empty key', () => {
    // Two different bad inputs both yield '', so a caller comparing keys must also
    // check truthiness — which is exactly why waitForAcceptResponse guards on
    // `!!targetKey` before trusting a match.
    expect(toCidKey('garbage')).toBe(toCidKey(null));
  });
});
