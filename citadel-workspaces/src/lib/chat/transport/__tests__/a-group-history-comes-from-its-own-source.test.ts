/**
 * Where a group conversation's history comes from, and what happens when it does not come.
 *
 * A node channel's pages are the workspace server's; a peer group has none there (the server
 * refuses a group no node owns) and its history is the local transcript. GroupChatView decided
 * this with a branch on the id inside a hook; here each transport has its own source, and these
 * tests pin both, and the deadline that stops a lost page from loading forever.
 *
 * MOCKS, and why: the node channel runs over the channel-server double (only the socket is
 * replaced). The peer group's port is a recording double, because its real one opens the agent's
 * socket and IndexedDB on import; what is under test is the transport over that port.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { LOADING_DEADLINE_MS } from '@/lib/loading-flag-timeout';
import { createValueStore } from '@/lib/value-store';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { channelServer, channelMessage } from './doubles/channel-server';
import { createNodeTransport } from '../node-transport';
import { browserClock } from '@/lib/browser-clock';
import type { RosterEntry } from '../read-receipts';
import { nodeChatIO } from '../node-chat-io';
import { nodeOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';
import { createPeerGroupTransport } from '../peer-group-transport';
import { groupLog } from '../group-log';
import type { PeerGroupChatIO } from '../peer-group-chat-io';
import type { ChatSelf, ChatTransport, HistoryPage } from '../chat-transport';

vi.mock('@/lib/workspace-service', async () => ({
  default: (await import('./doubles/channel-server')).channelServer.service,
}));

const CHANNEL: string = 'c0ffee00-0000-4000-8000-000000000002';
const PEER_GROUP: string = '7:42';
const SELF: ChatSelf = { cid: 7n, username: 'ada', displayName: 'Ada' };
const gate = (): ReturnType<typeof createValueStore<GroupRestriction>> => createValueStore<GroupRestriction>('test-gate', 'allowed');

function node(): ChatTransport {
  return createNodeTransport({ channelId: CHANNEL, nodeId: 'node-1', channelName: 'Design', self: SELF, sendGate: gate(), io: nodeChatIO(CHANNEL, 'node-1'), mintLocalId: (): string => 'local-1', now: (): number => 1,
    opening: nodeOpeningPorts('node-1', (): boolean => false),
    // Nobody's roster: these cases are about where pages come from, not who has read them.
    roster: createValueStore<readonly RosterEntry[] | null>('test-roster', null), clock: browserClock });
}

function peerGroup(restored: string[]): ChatTransport {
  const io: PeerGroupChatIO = {
    log: groupLog(PEER_GROUP),
    restore: async (): Promise<void> => { restored.push(PEER_GROUP); },
    send: async (): Promise<void> => undefined,
    react: async (): Promise<void> => undefined,
    share: async (): Promise<void> => undefined,
    markRead: (): void => undefined,
    focus: (): (() => void) => (): void => undefined,
    members: (): [] => [],
    transfers: { acceptTransfer: async (): Promise<void> => undefined, declineTransfer: async (): Promise<void> => undefined, cancelTransfer: async (): Promise<void> => undefined },
  };
  return createPeerGroupTransport({ groupId: PEER_GROUP, groupName: 'Friends', self: SELF, sendGate: gate(), io });
}

beforeEach((): void => {
  groupMessagingManager.clearAll();
  channelServer.reset(CHANNEL, 'ada', []);
});
afterEach((): void => { vi.useRealTimers(); });

describe('a node channel\'s history', () => {
  it('is the server\'s newest page, with a cursor while the server has older ones', async () => {
    channelServer.reset(CHANNEL, 'ada', Array.from({ length: 55 }, (_: unknown, i: number) => channelMessage(`m${i}`, 'bob', `line ${i}`, 1_000 + i, {})));
    const page: HistoryPage = await node().history.loadLatest();
    expect(page.messages).toHaveLength(50);
    expect(page.older).toEqual({ kind: 'before', timestamp: 1_005n });
    const older: HistoryPage = await node().history.loadOlder({ kind: 'before', timestamp: 1_005n });
    expect(older.messages.map((m) => m.content)).toEqual(['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
    expect(older.older).toBeNull();
  });

  it('stops loading, with the reason, when the server never answers', async () => {
    vi.useFakeTimers();
    channelServer.answersHistory = false;
    const outcome: Promise<string> = node().history.loadLatest().then((): string => 'loaded', (e: unknown): string => String(e));
    await vi.advanceTimersByTimeAsync(LOADING_DEADLINE_MS);
    expect(await outcome).toMatch(/did not answer/);
  });
});

describe('a peer group\'s history', () => {
  it('is its local transcript: the workspace server is never asked, and nothing older is offered', async () => {
    const restored: string[] = [];
    const page: HistoryPage = await peerGroup(restored).history.loadLatest();
    expect(restored).toEqual([PEER_GROUP]);
    expect(channelServer.requests).toEqual([]);
    expect(page.older).toBeNull();
  });

  it('can carry what a peer wire carries and nothing else', () => {
    const { features } = peerGroup([]);
    expect(features).toMatchObject({ reactions: true, files: true, revise: false, markdown: false, documents: false, settings: false });
  });
});
