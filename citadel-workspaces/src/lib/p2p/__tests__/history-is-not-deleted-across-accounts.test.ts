/**
 * One user logging in must not destroy another user's message history.
 *
 * Message pages live in LocalDB bucket `0n`, which every account on the device shares, under a
 * key that names the owner. `cleanupStaleConversations` deletes any cached conversation missing
 * from the CURRENT account's peer list, so the delete must still refuse a record stamped for
 * another account.
 *
 * These drive the real `deleteConversationPages` and assert on what reaches LocalDB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleted: string[] = [];
const stored: Map<string, string> = new Map<string, string>();
const cidRef: { current: bigint | null } = { current: null };

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return cidRef.current; } }) };
});

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string; }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
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

/** Seed `reader`'s key for the conversation, stamped for `owner`. */
function seed(key: string, owner: bigint): void {
  stored.set(key, JSON.stringify({
    peerCid: PEER.toString(), ownerCid: owner.toString(), totalMessageCount: 3, oldestMessageTimestamp: 1,
    newestMessageTimestamp: 3, latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 2, lastUpdated: 3,
  }));
}

describe('deleting a stored conversation', () => {
  beforeEach(() => { stored.clear(); deleted.length = 0; });

  it("does NOT delete a record stamped for another account, even under this account's key", async () => {
    cidRef.current = BOB;
    seed(`msgs_with_peer_${BOB}_with_${PEER}_metadata`, ALICE);
    await deleteConversationPages(PEER, { ownerCid: BOB });
    expect(deleted, "Bob's login deleted Alice's history").toHaveLength(0);
  });

  it("deletes the account's own conversation", async () => {
    cidRef.current = ALICE;
    seed(`msgs_with_peer_${ALICE}_with_${PEER}_metadata`, ALICE);
    await deleteConversationPages(PEER, { ownerCid: ALICE });
    expect(deleted).toContain(`msgs_with_peer_${ALICE}_with_${PEER}_metadata`);
  });

  it('never reads or deletes a record under the peer alone', async () => {
    cidRef.current = ALICE;
    seed(`msgs_with_peer_${PEER}_metadata`, ALICE);
    await deleteConversationPages(PEER, { ownerCid: ALICE });
    expect(deleted).toHaveLength(0);
  });
});
