/**
 * CID Utilities
 *
 * Centralized utilities for CID (Client ID) type conversion and manipulation.
 * CIDs are canonically bigint but may arrive as string or number from various sources.
 */

/**
 * Ensures a value is a bigint CID.
 * Handles string, number, and bigint inputs.
 * @throws Error if the value cannot be converted to a valid bigint
 */
export function ensureBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string') {
    return BigInt(value);
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  throw new Error(`Cannot convert ${typeof value} to bigint`);
}

/**
 * Safely converts a possibly-undefined CID to bigint.
 * Returns null if the value is null/undefined.
 */
export function ensureBigIntOrNull(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  return ensureBigInt(value);
}

/**
 * Converts two CID values to bigints (for peer pairs).
 * Common pattern in P2P operations.
 */
export function ensureBigIntPair(
  localCid: string | number | bigint,
  peerCid: string | number | bigint
): [bigint, bigint] {
  return [ensureBigInt(localCid), ensureBigInt(peerCid)];
}

/**
 * Converts a CID to string for serialization or display.
 */
export function cidToString(cid: bigint): string {
  return cid.toString();
}

/**
 * Creates a CID key for Map/Set operations.
 *
 * Delegates to `cidToString` rather than repeating `cid.toString()`: the two were
 * byte-identical implementations, so any future change to how a CID is stringified
 * had to be made in two places to stay correct. The distinct name is kept because it
 * documents intent at the call site (a Map key, not a display string).
 */
export function cidKey(cid: bigint): string {
  return cidToString(cid);
}

/** A CID as it may arrive from the wire, a URL param, or storage. */
export type CidLike = bigint | string | number | null | undefined;

/**
 * Canonical, full-precision key for a CID that may not already be a bigint.
 *
 * Returns '' for anything that is not a usable CID, so callers can treat '' as
 * "no match" without a try/catch.
 *
 * This replaces an older `normalizeCid` that compared only the LAST 10 DIGITS to
 * "handle JS precision loss with u64 values". That truncation predates the bigint
 * migration: CIDs are canonically bigint and cross the wire as CBOR with native
 * BigInt, so no precision is lost and the workaround is obsolete. Worse, it made two
 * distinct CIDs sharing their last 10 digits compare EQUAL, which in peer-registration
 * matching means accepting a response that belongs to a different peer.
 */
export function toCidKey(value: CidLike): string {
  if (value === null || value === undefined) return '';
  try {
    const cid: bigint = typeof value === 'bigint' ? value : BigInt(value);
    return cid > 0n ? cidToString(cid) : '';
  } catch {
    return '';
  }
}

/**
 * Creates a composite key from two CIDs (for peer pair tracking).
 * Normalizes order to ensure consistent keys regardless of direction.
 */
export function cidPairKey(cid1: bigint, cid2: bigint): string {
  const [smaller, larger] = cid1 < cid2 ? [cid1, cid2] : [cid2, cid1];
  return `${smaller.toString()}-${larger.toString()}`;
}

/**
 * Type guard to check if a value is a valid CID-like value.
 */
export function isCidLike(value: unknown): value is string | number | bigint {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
}

/**
 * Best-effort parse of a CID-like string into a bigint, returning
 * `undefined` for any malformed input rather than throwing.
 *
 * Use this on CID values arriving from URL params, IndexedDB
 * sessions, or anywhere a `BigInt(value)` call would otherwise
 * crash a render. The standard safe pattern:
 *
 * ```ts
 * const cid = tryParseCid(maybeCid);
 * if (cid === undefined) return <Fallback />;
 * // … use cid as bigint …
 * ```
 *
 * Centralised here (rather than re-implementing the try/catch at
 * each call site) so the test in
 * `cid-utils.test.ts#tryParseCid` is the single source of truth
 * for the parsing contract.
 */
/** Maximum valid CID: CIDs are u64-shaped, so reject anything above 2^64-1. */
const MAX_CID: bigint = (1n << 64n) - 1n; // 18446744073709551615

export function tryParseCid(value: string | undefined | null): bigint | undefined {
  // `BigInt()` is too lenient for CID parsing: `BigInt(' ')` is `0n` and
  // `BigInt('-1')` is `-1n`, so whitespace, zero, and negative strings would
  // slip through as "valid" CIDs and get used for routing / persisted
  // sessions. Require a plain non-empty decimal string and a positive result
  // within the u64 range (a longer digit string can't be a real CID).
  const trimmed: string | undefined = value?.trim();
  if (!trimmed || !/^[0-9]+$/.test(trimmed)) {
    return undefined;
  }
  // Bound the input length BEFORE calling BigInt(): u64::MAX is 20 digits, so
  // anything longer can't be a real CID and is rejected without parsing. This
  // stops a pathological multi-KB/MB digit string (from a crafted URL param or
  // corrupted session) from synchronously allocating an arbitrary-precision
  // BigInt and freezing the tab — the length check is O(1); BigInt parsing is
  // not.
  if (trimmed.length > 20) {
    return undefined;
  }
  const cid: bigint = BigInt(trimmed);
  return cid > 0n && cid <= MAX_CID ? cid : undefined;
}
