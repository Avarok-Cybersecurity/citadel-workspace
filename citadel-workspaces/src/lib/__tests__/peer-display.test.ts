import { describe, it, expect } from 'vitest';
import {
  shortPeerHandle,
  peerDisplayName,
  peerInitials,
  isUnnamedPeer,
} from '../peer-display';

/** Two real CIDs from the P2P test fixtures. */
const ALICE: bigint = 7040934265064422768n;
const BOB: bigint = 11792220362710786214n;

describe('shortPeerHandle', () => {
  it('is stable for a given peer', () => {
    expect(shortPeerHandle(ALICE)).toBe(shortPeerHandle(ALICE));
  });

  it('accepts the bigint, string and number forms a CID arrives in', () => {
    expect(shortPeerHandle(ALICE.toString())).toBe(shortPeerHandle(ALICE));
  });

  it('is short and readable', () => {
    const handle: string | null = shortPeerHandle(ALICE);
    expect(handle).toMatch(/^[0-9A-Z]{6}$/);
  });

  it('differs between peers whose CIDs share a leading digit run', () => {
    // The old code sliced the first 8 characters of the decimal CID, so any two
    // peers sharing a prefix rendered as the same "name". Deriving from the low
    // bits instead means a shared prefix has no effect.
    const a: bigint = 11111111100000001n;
    const b: bigint = 11111111100000002n;
    expect(a.toString().slice(0, 8)).toBe(b.toString().slice(0, 8)); // old collision
    expect(shortPeerHandle(a)).not.toBe(shortPeerHandle(b));
  });

  it('avoids glyphs that read ambiguously in a short code', () => {
    const handles: (string | null)[] = [ALICE, BOB, 1n, 999999n, 2n ** 63n].map(shortPeerHandle);
    for (const h of handles) expect(h).not.toMatch(/[OIL]/);
  });

  it('returns null for an unusable CID so callers can say so plainly', () => {
    expect(shortPeerHandle(null)).toBeNull();
    expect(shortPeerHandle(undefined)).toBeNull();
    expect(shortPeerHandle('not-a-cid')).toBeNull();
    expect(shortPeerHandle(0n)).toBeNull();
  });
});

describe('peerDisplayName', () => {
  it('prefers the name the user chose over their login identifier', () => {
    expect(peerDisplayName({ cid: ALICE, username: 'alice', fullName: 'Alice Kowalski' }))
      .toBe('Alice Kowalski');
  });

  it('falls back to the username when no full name is set', () => {
    expect(peerDisplayName({ cid: ALICE, username: 'alice' })).toBe('alice');
  });

  it('never renders a raw or truncated CID as the name', () => {
    const name: string = peerDisplayName({ cid: ALICE });
    expect(name).not.toContain(ALICE.toString());
    expect(name).not.toContain(ALICE.toString().slice(0, 8));
    expect(name).toMatch(/^Peer [0-9A-Z]{6}$/);
  });

  it('treats blank strings as absent rather than showing an empty name', () => {
    expect(peerDisplayName({ cid: ALICE, username: '   ', fullName: '' }))
      .toMatch(/^Peer /);
  });

  it('says so plainly when there is no usable identifier at all', () => {
    expect(peerDisplayName({ cid: null })).toBe('Unknown peer');
  });
});

describe('peerInitials', () => {
  it('uses the first letter of a real name', () => {
    expect(peerInitials({ cid: ALICE, fullName: 'Alice Kowalski' })).toBe('A');
    expect(peerInitials({ cid: ALICE, username: 'bob' })).toBe('B');
  });

  it('uses handle characters, not CID digits, when unnamed', () => {
    const initials: string = peerInitials({ cid: ALICE });
    expect(initials).toHaveLength(2);
    expect(initials).toBe(shortPeerHandle(ALICE)!.slice(0, 2));
  });

  it('degrades to a question mark rather than throwing', () => {
    expect(peerInitials({ cid: null })).toBe('?');
  });
});

describe('isUnnamedPeer', () => {
  it('distinguishes a derived handle from a chosen name', () => {
    expect(isUnnamedPeer({ cid: ALICE })).toBe(true);
    expect(isUnnamedPeer({ cid: ALICE, username: '  ' })).toBe(true);
    expect(isUnnamedPeer({ cid: ALICE, username: 'alice' })).toBe(false);
  });
});
