/**
 * A peer group kept no history. The owner posted, reloaded, and saw "No
 * messages yet": the workspace server holds nothing for a group no node owns,
 * and `group-persistence` stores the group LIST, not messages.
 *
 * The messaging manager, the binding, the delivery path and the transcript
 * store all run for real. `storage-utils` is replaced by a Map because jsdom
 * has no IndexedDB and fake-indexeddb is not a dependency; it round-trips
 * through `structuredClone`, which is what IndexedDB does to a value, so a
 * bigint that would not survive the real store does not survive this one.
 * `instanceManager` is replaced to choose which account is signed in.
 *
 * A "reload" is `vi.resetModules()`: every module, the manager's in-memory
 * thread and the store's write queue start again; only the Map persists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';
import type { GroupMessage } from '@/types/workspace-entities';

const world: { store: Map<string, unknown>; cid: bigint | null; failReads: boolean } = vi.hoisted(() => ({
  store: new Map<string, unknown>(), cid: null as bigint | null, failReads: false,
}));

vi.mock('@/lib/storage-utils', () => ({
  dbGet: async (_s: string, k: string): Promise<unknown> => {
    if (world.failReads) throw new Error('storage unavailable');
    return world.store.has(k) ? structuredClone(world.store.get(k)) : undefined;
  },
  dbPut: async (_s: string, k: string, v: unknown): Promise<void> => { world.store.set(k, structuredClone(v)); },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return world.cid; } }) };
});

const PEER_GROUP: string = '7:42';

interface Session {
  thread: () => GroupMessage[];
  deliver: (id: string, content: string, timestamp: number) => void;
  restore: () => Promise<void>;
  stored: () => Promise<GroupMessage[]>;
  manager: typeof import('@/lib/group-messaging-manager')['groupMessagingManager'];
  stop: () => void;
}

async function boot(groupId: string = PEER_GROUP): Promise<Session> {
  vi.resetModules();
  const { groupMessagingManager } = await import('@/lib/group-messaging-manager');
  const { bindGroupTranscript } = await import('../bind-group-transcript');
  const { deliverPeerGroupMessage } = await import('../peer-group-delivery');
  const store: typeof import('../group-transcript-store') = await import('../group-transcript-store');
  const stop: () => void = bindGroupTranscript();
  return {
    thread: (): GroupMessage[] => groupMessagingManager.getMessages(groupId).messages,
    deliver: (id: string, content: string, timestamp: number): void => deliverPeerGroupMessage({
      groupId, messageId: id, senderId: '7', senderName: 'ada', content, timestamp,
    }),
    restore: (): Promise<void> => store.restoreGroupTranscript(groupId),
    stored: (): Promise<GroupMessage[]> => store.loadTranscript(groupId),
    manager: groupMessagingManager,
    stop,
  };
}

beforeEach((): void => { world.store.clear(); world.cid = 111n; world.failReads = false; });

describe('a peer group transcript', () => {
  it('survives a reload, bigint timestamps and all', async () => {
    const before: Session = await boot();
    before.deliver('m1', 'hello', 1_000);
    before.deliver('m2', 'still here?', 2_000);
    await before.stored();
    before.stop();

    const after: Session = await boot();
    expect(after.thread(), 'the reload must start from an empty thread, or this proves nothing').toEqual([]);
    await after.restore();
    expect(after.thread().map((m: GroupMessage): string => m.content)).toEqual(['hello', 'still here?']);
    expect(after.thread()[1].timestamp).toBe(2_000n);
  });

  it('is invisible to another account in the same browser', async () => {
    const alice: Session = await boot();
    alice.deliver('m1', 'for alice only', 1_000);
    await alice.stored();
    alice.stop();

    world.cid = 222n;
    const bob: Session = await boot();
    await bob.restore();
    expect(bob.thread(), 'bob read alice\'s transcript').toEqual([]);
    bob.stop();

    world.cid = 111n;
    const aliceAgain: Session = await boot();
    await aliceAgain.restore();
    expect(aliceAgain.thread().map((m: GroupMessage): string => m.id), 'alice\'s own copy must still be there').toEqual(['m1']);
  });

  it('stores a redelivered message once, even after a reload emptied the thread', async () => {
    const before: Session = await boot();
    before.deliver('m1', 'hello', 1_000);
    before.deliver('m1', 'hello', 1_000);
    await before.stored();
    before.stop();

    // After a reload the manager's own dedupe has nothing to compare against,
    // so this redelivery reaches the binding as a new message.
    const after: Session = await boot();
    after.deliver('m1', 'hello', 1_000);
    expect((await after.stored()).map((m: GroupMessage): string => m.id)).toEqual(['m1']);
  });

  it('keeps only the newest TRANSCRIPT_CAP messages', async () => {
    const { TRANSCRIPT_CAP } = await import('../group-transcript');
    const session: Session = await boot();
    const total: number = TRANSCRIPT_CAP + 5;
    for (let i: number = 0; i < total; i++) session.deliver(`m${i}`, `n${i}`, 1_000 + i);
    const kept: GroupMessage[] = await session.stored();
    expect(kept).toHaveLength(TRANSCRIPT_CAP);
    expect(kept[0].id, 'the oldest five are the ones dropped').toBe('m5');
    expect(kept[kept.length - 1].id).toBe(`m${total - 1}`);
  });

  it('records edits and deletes the manager applies', async () => {
    const session: Session = await boot();
    session.deliver('m1', 'draft', 1_000);
    session.deliver('m2', 'doomed', 2_000);
    session.manager.handleMessageEdited(PEER_GROUP, 'm1', 'final', 3_000n);
    session.manager.handleMessageDeleted(PEER_GROUP, 'm2');
    const kept: GroupMessage[] = await session.stored();
    expect(kept.map((m: GroupMessage): string => `${m.id}:${m.content}`)).toEqual(['m1:final']);
    expect(kept[0].edited_at).toBe(3_000n);
  });

  it('does not overwrite a transcript it could not read', async () => {
    const session: Session = await boot();
    session.deliver('m1', 'hello', 1_000);
    await session.stored();

    world.failReads = true;
    session.deliver('m2', 'after the failure', 2_000);
    await session.stored();
    world.failReads = false;
    expect((await session.stored()).map((m: GroupMessage): string => m.id)).toEqual(['m1']);
  });

  it('does not wipe a message already on screen when restoring', async () => {
    const session: Session = await boot();
    world.failReads = true;
    // Arrives while storage is failing, so it is on screen and nowhere else.
    session.deliver('live', 'just arrived', 5_000);
    await session.restore();
    expect(session.thread().map((m: GroupMessage): string => m.id)).toEqual(['live']);
  });

  it('keeps no copy of a node-backed channel, whose history the server holds', async () => {
    const channel: string = '9f3c1e2a-0000-4000-8000-000000000001';
    const session: Session = await boot(channel);
    session.deliver('w1', 'server-backed', 1_000);
    expect(session.thread(), 'the message must have reached the thread').toHaveLength(1);
    await session.stored();
    expect(world.store.size).toBe(0);
  });

  // The registration, not only the binding: every test above calls
  // bindGroupTranscript by hand, so they stay green with it never installed.
  it('is recorded by the bindings the store starts, from a received message', async () => {
    vi.resetModules();
    const { startGroupEventBindings } = await import('../group-store');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const store: typeof import('../group-transcript-store') = await import('../group-transcript-store');
    startGroupEventBindings(noSessionUsername);

    eventEmitter.emit('group:message-received', {
      groupId: PEER_GROUP, messageId: 'm-received', senderId: '9', senderName: 'bob',
      content: 'from a member', timestamp: 1_000,
    });
    expect((await store.loadTranscript(PEER_GROUP)).map((m: GroupMessage): string => m.id)).toEqual(['m-received']);
  });
});
