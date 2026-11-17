/**
 * A conversation switch must not carry the previous peer's messages.
 *
 * `useP2PMessages` resets `messages` only when `peerCid` is FALSY, so switching
 * from Alice to Bob left the array populated — and `mergeMessages` dedups by
 * message id alone, never by peer, so Alice's messages merged into Bob's thread
 * by timestamp. `P2PMessageList` labels every non-own message with the CURRENT
 * `peerName`, so they rendered as if Bob had sent them.
 *
 * The fix is a `key` on the component, which is a React-level property these
 * tests cannot observe. What they CAN pin is why a stale array was dangerous:
 * mergeMessages will silently interleave two peers' history if it is ever
 * handed one. If the key is later removed, or a cross-peer merge reintroduced,
 * this states plainly what the function does and does not guarantee.
 */
import { describe, it, expect } from 'vitest';
import { mergeMessages } from '../useP2PMessages-types';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

const ALICE: bigint = 10n;
const BOB: bigint = 20n;

function msg(id: string, senderCid: bigint, timestamp: number): P2PMessage {
  return { id, senderCid, recipientCid: 1n, content: 'x', timestamp, index: 0, status: 'delivered' } as P2PMessage;
}

describe('mergeMessages offers no peer isolation', () => {
  it('interleaves two peers by timestamp when handed a stale array', () => {
    // Documents the hazard rather than endorsing it: this is exactly what
    // happened on every conversation switch before the components were keyed.
    const stale: P2PMessage[] = [msg('a1', ALICE, 100), msg('a2', ALICE, 300)];
    const incoming: P2PMessage[] = [msg('b1', BOB, 200)];

    const merged: P2PMessage[] = mergeMessages(stale, incoming);

    expect(merged.map((m) => m.id)).toEqual(['a1', 'b1', 'a2']);
    expect(merged.some((m) => m.senderCid === ALICE)).toBe(true);
  });

  it('starts clean when the previous conversation left nothing behind', () => {
    // The keyed-component case: a fresh mount has an empty array, so the new
    // peer's thread contains only the new peer's messages.
    const merged: P2PMessage[] = mergeMessages([], [msg('b1', BOB, 200)]);

    expect(merged.map((m) => m.id)).toEqual(['b1']);
    expect(merged.every((m) => m.senderCid === BOB)).toBe(true);
  });

  it('deduplicates by id, so a resend of the same message is not doubled', () => {
    const merged: P2PMessage[] = mergeMessages([msg('b1', BOB, 200)], [msg('b1', BOB, 200)]);
    expect(merged).toHaveLength(1);
  });
});
