/**
 * A shared file, and the sender's per-member ledger, survive a reload.
 *
 * Same harness as a-peer-group-keeps-its-history: the manager, the transcript
 * binding, the delivery path and the store all run for real; `storage-utils` is
 * a Map that round-trips through `structuredClone` (what IndexedDB does to a
 * value, so the bigint CIDs in the ledger are held to the real rule), and a
 * reload is `vi.resetModules()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';
import type { GroupMessage } from '@/types/workspace-entities';
import type { GroupMember } from '@/types/group';

const world: { store: Map<string, unknown>; cid: bigint | null } = vi.hoisted(() => ({
  store: new Map<string, unknown>(), cid: null as bigint | null,
}));

vi.mock('@/lib/storage-utils', () => ({
  dbGet: async (_s: string, k: string): Promise<unknown> => (world.store.has(k) ? structuredClone(world.store.get(k)) : undefined),
  dbPut: async (_s: string, k: string, v: unknown): Promise<void> => { world.store.set(k, structuredClone(v)); },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return world.cid; } }) };
});
// Held across the reloads as the real module: the socket service and the
// connection layer behind it are ~220 of the ~270 modules a reload re-imports,
// hold no transcript (sends go through the injected `sendFile`), and every reset
// module is a round trip to the vitest main process -- seconds per reload on a
// loaded runner. See p2p/__tests__/an-edit-or-delete-survives-a-reload.
vi.mock('@/lib/websocket-service', async (importOriginal) => importOriginal());

// Transformed at collection, which no test timeout measures, not in the first test.
import '../bind-group-transcript';
import '../peer-group-delivery';
import '../share-file-with-group';
import '../group-store';
import '@/lib/group-messaging-manager';

const GROUP: string = '111:42';
const members: GroupMember[] = [
  { cid: 111n, username: 'me', roleId: 'owner', joinedAt: 0 },
  { cid: 13069842581551822719n, username: 'ada', roleId: 'member', joinedAt: 0 },
  { cid: 3n, username: 'bob', roleId: 'member', joinedAt: 0 },
];

async function load(): Promise<GroupMessage[]> {
  const { groupMessagingManager } = await import('@/lib/group-messaging-manager');
  const { restoreGroupTranscript } = await import('../group-transcript-store');
  await restoreGroupTranscript(GROUP);
  return groupMessagingManager.getMessages(GROUP).messages;
}

beforeEach((): void => { world.store.clear(); world.cid = 111n; });

describe('a shared file after a reload', () => {
  it('keeps the sender\'s ledger, bigint CIDs and all', async () => {
    vi.resetModules();
    const { bindGroupTranscript } = await import('../bind-group-transcript');
    const { deliverPeerGroupMessage } = await import('../peer-group-delivery');
    const { shareFileWithGroup } = await import('../share-file-with-group');
    const { loadTranscript } = await import('../group-transcript-store');
    const stop: () => void = bindGroupTranscript();
    await shareFileWithGroup(GROUP, members, new File(['abc'], 'a.txt', { type: 'text/plain' }), {
      selfCid: 111n,
      isRegistered: (cid: bigint): boolean => cid !== 3n,
      sendFile: async (r: string): Promise<string> => `t-${r}`,
      announce: async (): Promise<string> => 'f-1',
      deliverOwn: deliverPeerGroupMessage,
      now: (): number => 1_000,
    });
    await loadTranscript(GROUP);
    stop();

    vi.resetModules();
    const thread: GroupMessage[] = await load();
    expect(thread.map((m: GroupMessage): string => m.id)).toEqual(['f-1']);
    expect(thread[0].file_share?.deliveries).toEqual([
      { kind: 'offered', cid: 13069842581551822719n, username: 'ada', transferId: 't-13069842581551822719' },
      { kind: 'skipped', cid: 3n, username: 'bob', reason: 'not P2P-registered with you' },
    ]);
    expect(thread[0].file_share?.name).toBe('a.txt');
  });

  it('keeps a received announcement as a file, not as text', async () => {
    vi.resetModules();
    const { startGroupEventBindings } = await import('../group-store');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const { loadTranscript } = await import('../group-transcript-store');
    startGroupEventBindings(noSessionUsername);
    eventEmitter.emit('group:message-received', {
      groupId: GROUP, messageId: 'f-2', senderId: '9', senderName: 'bob', content: 'Shared a file: b.txt (3 B)',
      timestamp: 2_000, fileShare: { name: 'b.txt', size: 3, mimeType: 'text/plain', senderCid: 9n },
    });
    await loadTranscript(GROUP);

    vi.resetModules();
    const thread: GroupMessage[] = await load();
    expect(thread[0].file_share).toEqual({ name: 'b.txt', size: 3, mimeType: 'text/plain', senderCid: 9n });
  });
});
