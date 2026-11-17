/**
 * One account's contact list appeared in another's.
 *
 * Message pages live in LocalDB bucket `0n`, which every account on this device
 * shares — the product explicitly expects several accounts in one browser.
 * `ConversationMetadata.ownerCid` exists precisely because of that: its own
 * doc-comment records that without it `cleanupStaleConversations` deleted every
 * OTHER account's history as stale.
 *
 * That stamp was wired into the DELETE path and not the READ path.
 * `loadAllMetadata` lists every `msgs_with_peer_*_metadata` key in the shared
 * bucket and returns all of them, so `loadFromStorage` seeds the conversation
 * cache with other accounts' rows and the P2P peer list renders them — who
 * Alice talks to, and her unread counts, shown to Bob.
 *
 * Unattributed legacy records are still returned. An unknown owner is exactly
 * the case where withholding is as wrong as leaking: those predate the stamp
 * and belong to whoever is reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stored: Map<string, string> = new Map<string, string>();
let currentCid: bigint | null = 111n;

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBListKeys: async (): Promise<string[]> => [...stored.keys()],
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = stored.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (): Promise<undefined> => undefined,
    sendLocalDBDelete: async (): Promise<undefined> => undefined,
  },
}));

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return currentCid; } }) };
});

const { messagePaginationStore } = await import('../message-pagination-store');
import type { ConversationMetadata } from '../p2p-types';

const MINE: bigint = 111n;
const THEIRS: bigint = 222n;

function metadataKey(owner: bigint | null, peer: bigint): string {
  return owner === null
    ? `msgs_with_peer_${peer}_metadata`
    : `msgs_with_peer_${owner}_with_${peer}_metadata`;
}

function seed(owner: bigint | null, peer: bigint): void {
  const record: Record<string, unknown> = {
    peerCid: peer.toString(),
    ownerCid: owner === null ? undefined : owner.toString(),
    peerUsername: `peer-${peer}`,
    totalMessageCount: 1, oldestMessageTimestamp: 1, newestMessageTimestamp: 1,
    latestPage: 0, messagesPerPage: 50, unreadCount: 3, lastMessageIndex: 0, lastUpdated: 1,
  };
  stored.set(metadataKey(owner, peer), JSON.stringify(record));
}

describe('loading every conversation on a shared device', () => {
  beforeEach((): void => { stored.clear(); currentCid = MINE; });

  it('does not return another account’s conversations', async () => {
    seed(MINE, 900n);
    seed(THEIRS, 901n);

    const all: ConversationMetadata[] = await messagePaginationStore.loadAllMetadata();

    expect(all.map((m) => m.peerCid)).toEqual([900n]);
  });

  it('still returns records written before the owner stamp existed', async () => {
    // An unknown owner is the case where withholding is as wrong as leaking:
    // these predate the stamp and belong to whoever is reading.
    seed(null, 902n);

    const all: ConversationMetadata[] = await messagePaginationStore.loadAllMetadata();

    expect(all.map((m) => m.peerCid)).toEqual([902n]);
  });

  it('returns the other account’s rows when THEY are the one reading', async () => {
    // Negative control: a filter that dropped everything would pass the first
    // assertion. The same records must be visible to their owner.
    seed(MINE, 900n);
    seed(THEIRS, 901n);
    currentCid = THEIRS;

    const all: ConversationMetadata[] = await messagePaginationStore.loadAllMetadata();

    expect(all.map((m) => m.peerCid)).toEqual([901n]);
  });

  it('returns everything attributable when no session is selected yet', async () => {
    // Boot before a cid is known. Filtering to "nothing" here would empty the
    // list for a legitimate reader; the caller re-runs once the cid arrives.
    seed(MINE, 900n);
    currentCid = null;

    const all: ConversationMetadata[] = await messagePaginationStore.loadAllMetadata();

    expect(all.map((m) => m.peerCid)).toEqual([900n]);
  });
});
