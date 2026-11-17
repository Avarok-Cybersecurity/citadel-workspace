/**
 * Clearing YOUR conversation must not delete SOMEBODY ELSE'S copy of it.
 *
 * `deleteConversationPages` checked ownership once, against the account-scoped
 * metadata, and then deleted the legacy peer-only records too — a DIFFERENT
 * record, with its own owner stamp, that nothing had looked at. The comment
 * there said the check "has already run, so this only removes records that are
 * ours"; it had not run on anything in that branch.
 *
 * Both accounts on one device having chatted with the same peer is the whole
 * precondition, and it is reachable: `appendUnserialised` stamps `ownerCid` from
 * `resolveCurrentCid()` (which falls back to stored session state) while the key
 * comes from `instanceManager.cid` directly and collapses to the legacy shape
 * when that is null — so a record can be written under the unscoped key with a
 * real owner stamp, today.
 *
 * `history-is-not-deleted-across-accounts.test.ts` cannot see this: it does not
 * mock `instanceManager`, so `instanceManager.cid` is null there,
 * `conversationPrefix` collapses to the legacy prefix, and `hasLegacyFallback`
 * is false in every one of its cases — the branch below is never entered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const deleted: string[] = [];
const stored: Map<string, string> = new Map<string, string>();

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string; }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (): Promise<undefined> => undefined,
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => {
      deleted.push(key);
    },
  },
}));

const ALICE: bigint = 111n;
const BOB: bigint = 222n;
const PEER: bigint = 999n;

// The session doing the deleting. Without this the legacy branch is unreachable
// and every assertion below passes on a build with no fix in it.
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: BOB }) };
});

const { deleteConversationPages } = await import('../message-page-delete');

function metadataJson(owner: bigint | undefined, latestPage: number): string {
  return JSON.stringify({
    peerCid: PEER.toString(),
    ownerCid: owner === undefined ? undefined : owner.toString(),
    totalMessageCount: 3,
    oldestMessageTimestamp: 1,
    newestMessageTimestamp: 3,
    latestPage,
    messagesPerPage: 50,
    unreadCount: 0,
    lastMessageIndex: 2,
    lastUpdated: 3,
  });
}

const SCOPED_META: string = `msgs_with_peer_${BOB}_with_${PEER}_metadata`;
const LEGACY_META: string = `msgs_with_peer_${PEER}_metadata`;

beforeEach(() => {
  stored.clear();
  deleted.length = 0;
});

describe("clearing Bob's conversation", () => {
  it("does not touch Alice's legacy records for the same peer", async () => {
    stored.set(SCOPED_META, metadataJson(BOB, 0));
    stored.set(LEGACY_META, metadataJson(ALICE, 2));

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: true });

    expect(deleted).toContain(SCOPED_META);
    expect(deleted.filter((key: string) => key.startsWith(`msgs_with_peer_${PEER}_`))).toEqual([]);
    expect(deleted).not.toContain(LEGACY_META);
  });

  it("does delete Bob's OWN legacy records, or the read fallback resurrects them", async () => {
    // The reason the legacy delete exists at all. Losing it to the fix would
    // restore the bug it was written for: a cleared conversation reappearing on
    // the next reload after the user was told it could not be undone.
    stored.set(SCOPED_META, metadataJson(BOB, 0));
    stored.set(LEGACY_META, metadataJson(BOB, 1));

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: true });

    expect(deleted).toContain(LEGACY_META);
    // Its OWN page count, not the scoped record's — using the scoped record's
    // `latestPage` (0) left page 1 orphaned in LocalDB forever.
    expect(deleted).toContain(`msgs_with_peer_${PEER}_1`);
  });

  it("leaves an unattributed legacy record alone during a background sweep", async () => {
    stored.set(SCOPED_META, metadataJson(BOB, 0));
    stored.set(LEGACY_META, metadataJson(undefined, 0));

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: false });

    expect(deleted).toContain(SCOPED_META);
    expect(deleted).not.toContain(LEGACY_META);
  });

  it("removes an unattributed legacy record on an explicit clear", async () => {
    // Same rule an unstamped scoped record already follows: the user has the
    // conversation open and is acting on it deliberately, so refusing would make
    // their own button silently do nothing.
    stored.set(SCOPED_META, metadataJson(BOB, 0));
    stored.set(LEGACY_META, metadataJson(undefined, 0));

    await deleteConversationPages(PEER, { ownerCid: BOB, includeUnattributed: true });

    expect(deleted).toContain(LEGACY_META);
  });
});
