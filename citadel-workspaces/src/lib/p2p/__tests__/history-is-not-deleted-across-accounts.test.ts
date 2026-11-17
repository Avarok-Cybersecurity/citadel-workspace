/**
 * One user logging in must not destroy another user's message history.
 *
 * Message pages are keyed by PEER alone — `msgs_with_peer_{peerCid}_…` — and
 * live in LocalDB bucket `0n`, which every account on the device shares.
 * Nothing recorded whose conversation a record was.
 *
 * `cleanupStaleConversations` deletes any cached conversation missing from the
 * CURRENT account's peer list — which is true of every conversation belonging
 * to a different account. So user B logging in permanently deleted user A's
 * messages, on a device this product explicitly expects to hold several
 * accounts, and the deletion is unrecoverable.
 *
 * These drive the real `deleteConversationPages` and assert on what reaches
 * LocalDB, because the whole defect is about which keys get a delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleted: string[] = [];
const stored: Map<string, string> = new Map<string, string>();

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string; }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      // The shape the real client returns: { value } where value may be a
      // string or a byte array.
      return { value };
    },
    sendLocalDBSet: async (): Promise<undefined> => undefined,
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => {
      deleted.push(key);
    },
  },
}));

const { deleteConversationPages } = await import('../message-page-delete');

const ALICE: bigint = 111n;
const BOB: bigint = 222n;
const PEER: bigint = 999n;

/** Seed one conversation's metadata as `owner` (undefined = a legacy record). */
function seedConversation(owner: bigint | undefined): void {
  stored.clear();
  deleted.length = 0;
  stored.set(
    `msgs_with_peer_${PEER}_metadata`,
    JSON.stringify({
      peerCid: PEER.toString(),
      ownerCid: owner === undefined ? undefined : owner.toString(),
      totalMessageCount: 3,
      oldestMessageTimestamp: 1,
      newestMessageTimestamp: 3,
      latestPage: 0,
      messagesPerPage: 50,
      unreadCount: 0,
      lastMessageIndex: 2,
      lastUpdated: 3,
    })
  );
}

describe('the automatic stale-conversation sweep', () => {
  beforeEach(() => {
    deleted.length = 0;
  });

  it("does NOT delete a conversation belonging to another account", async () => {
    seedConversation(ALICE);

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: false });

    expect(deleted, "Bob's login deleted Alice's history").toHaveLength(0);
  });

  it('does not delete a record whose owner is unknown', async () => {
    // Written before the owner stamp existed. Unknown ownership is exactly
    // when destroying data is unsafe.
    seedConversation(undefined);

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: false });

    expect(deleted).toHaveLength(0);
  });

  it('does delete the account\'s own conversation', async () => {
    seedConversation(ALICE);

    await deleteConversationPages(PEER, { ownerCid: ALICE, includeUnattributed: false });

    // The sweep must still work, or this is just a disabled feature.
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted).toContain(`msgs_with_peer_${PEER}_metadata`);
  });
});

describe('an explicit "clear this conversation"', () => {
  it('may delete an unattributed record the user has open', async () => {
    seedConversation(undefined);

    await deleteConversationPages(PEER, { ownerCid: ALICE, includeUnattributed: true });

    // Refusing here would make the user's own button silently do nothing.
    expect(deleted.length).toBeGreaterThan(0);
  });

  it('still refuses one that demonstrably belongs to someone else', async () => {
    seedConversation(ALICE);

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: true });

    expect(deleted).toHaveLength(0);
  });
});
