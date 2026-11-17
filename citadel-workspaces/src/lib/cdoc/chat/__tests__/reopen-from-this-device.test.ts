/**
 * A chat document reopened from this device is the document it was: the stored snapshot plus
 * the updates applied since, before and after a fold, with nothing from the peer needed. The
 * copy is the local account's alone: kept under its cid (never the device-wide 0), so another
 * account on the same agent cannot read it. A stored copy in another format is not opened.
 */
import { describe, expect, it } from 'vitest';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { hyphenated } from '../../__tests__/wasm-rig';
import type { EditorSession } from '../../editor/editor-session';
import type { EditorOrigin, PeerView } from '../../editor/controller';
import { CHAT_SYNC } from '../chat-config';
import { localDbChatStore } from '../chat-local-db';
import type { ChatStoreBackend } from '../chat-ports';
import { ChatSyncError } from '../chat-problems';
import { ALICE, BLANK, BOB, DOC, newWorld, openSide, sameDocument, settle, textOf, type ChatSide, type World } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';

/** The live replica's snapshot, then the document closed (its last write done). */
async function closeAndWrite(side: ChatSide): Promise<Uint8Array> {
  const live: Uint8Array = await side.editor().snapshot();
  await side.close();
  return live;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Array.from(a).join(',') === Array.from(b).join(',');

describe('a chat document reopened from this device', () => {
  it('equals the live replica: the snapshot and the updates since it, nothing from the peer', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    await typeInto(alice.editor(), 'kept on this device');
    world.clock.advance(CHAT_SYNC.storeAfterIdleMs);
    await typeInto(alice.editor(), ', and after the first write');
    const live: Uint8Array = await closeAndWrite(alice);
    world.channel.up = false;
    const again: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(sameBytes(await again.editor().snapshot(), live)).toBe(true);
    expect(await textOf(again.editor())).toContain('kept on this device, and after the first write');
    expect(again.problems).toEqual([]);
  });

  it('equals the live replica after its updates were folded into a new snapshot', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    world.clock.advance(CHAT_SYNC.storeAfterIdleMs);
    await typeInto(alice.editor(), 'x'.repeat(CHAT_SYNC.foldAfterUpdates + 5));
    world.clock.advance(CHAT_SYNC.storeAfterIdleMs);
    await alice.sync().settled();
    await typeInto(alice.editor(), 'tail');
    const live: Uint8Array = await closeAndWrite(alice);
    const again: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(sameBytes(await again.editor().snapshot(), live)).toBe(true);
    const pending: readonly Uint8Array[] = await localDbChatStore(ALICE, db.connection([ALICE])).loadPending(DOC);
    expect(pending.length).toBeLessThan(CHAT_SYNC.foldAfterUpdates);
  });

  it('holds what the peer sent too, and goes on converging with the peer after the reopen', async () => {
    const world: World = newWorld();
    const aliceDb: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, aliceDb, BLANK);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
    await typeInto(bob.editor(), 'from bob');
    await settle(world, [alice, bob]);
    const live: Uint8Array = await closeAndWrite(alice);
    const again: ChatSide = await openSide(world, ALICE, BOB, aliceDb, BLANK);
    expect(sameBytes(await again.editor().snapshot(), live)).toBe(true);
    await typeInto(bob.editor(), ' and more');
    await settle(world, [again, bob]);
    expect(await sameDocument(again.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
  });

  it('opens each replica with a fresh client id, never the migration\'s', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    // hyphenated() migrates a document as client 3, as a conversion from the old format would.
    const migrated: EditorOrigin = hyphenated(null, 'migrated text');
    if (migrated.kind !== 'snapshot') throw new Error('expected a snapshot');
    const clientOf = async (e: EditorSession): Promise<bigint> => ((await e.peerView(await e.awareness())) as PeerView).client;
    const first: ChatSide = await openSide(world, ALICE, BOB, db, { kind: 'migrated', snapshot: migrated.snapshot, migrationOrigin: 'yjs:chat-doc-1' });
    const firstId: bigint = await clientOf(first.editor());
    await closeAndWrite(first);
    const second: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(await textOf(second.editor())).toContain('migrated text');
    const secondId: bigint = await clientOf(second.editor());
    expect([firstId === 3n, secondId === 3n, firstId === secondId]).toEqual([false, false, false]);
  });

  it('refuses a stored copy in another CRDT format, and leaves it as it is', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const store: ChatStoreBackend = localDbChatStore(ALICE, db.connection([ALICE]));
    await store.saveBase(DOC, { docVersion: CHAT_SYNC.docVersion + 1, snapshot: new Uint8Array([1, 2, 3]), migrationOrigin: null });
    const opened: Promise<ChatSide> = openSide(world, ALICE, BOB, db, BLANK);
    await expect(opened).rejects.toBeInstanceOf(ChatSyncError);
    await expect(opened).rejects.toMatchObject({ problem: { kind: 'docVersionMismatch', where: 'the stored copy', received: CHAT_SYNC.docVersion + 1 } });
    expect((await store.loadBase(DOC))?.docVersion).toBe(CHAT_SYNC.docVersion + 1);
  });
});

describe('the copy on this device belongs to the local account', () => {
  it('is kept under the account\'s cid, never cid 0, and another account cannot read it', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    await typeInto(alice.editor(), 'private to alice');
    await closeAndWrite(alice);
    expect(db.requests.length).toBeGreaterThan(3);
    expect(db.requests.every((r): boolean => r.cid === ALICE && r.key.startsWith(`cdoc-chat:${ALICE.toString()}:`))).toBe(true);
    expect(db.keys(0n)).toEqual([]);
    // Another account on the same agent: its own cid finds nothing, and naming Alice's is refused.
    const other: ChatStoreBackend = localDbChatStore(BOB, db.connection([BOB]));
    expect(await other.loadBase(DOC)).toBeNull();
    await expect(db.connection([BOB]).get(ALICE, `cdoc-chat:${ALICE.toString()}:${DOC}#base`)).rejects.toThrow(/Refused/);
    expect((): unknown => localDbChatStore(0n, db.connection([0n]))).toThrow(/local account/);
  });
});
