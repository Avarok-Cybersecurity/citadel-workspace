/**
 * A chat document reopened from this device is the document it was: the stored snapshot plus
 * the updates applied since, before and after a fold, with nothing from the peer needed. The
 * copy is the local account's alone: kept under its cid (never the device-wide 0), so another
 * account on the same agent cannot read it. A stored copy in another format is not opened.
 */
import { encode as cborEncode } from 'cbor-x';
import { describe, expect, it } from 'vitest';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { hyphenated } from '../../__tests__/wasm-rig';
import type { EditorSession } from '../../editor/editor-session';
import type { EditorOrigin, PeerView } from '../../editor/controller';
import { CHAT_SYNC } from '../chat-config';
import { localDbChatStore, type LocalDbPort } from '../chat-local-db';
import { aloneInBrowser } from './doubles/browser-tabs';
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
    const pending: readonly Uint8Array[] = await localDbChatStore(ALICE, db.connection([ALICE]), aloneInBrowser()).loadPending(DOC);
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

  it('opens each replica with a fresh client id, never the one its stored snapshot was written by', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    // hyphenated() writes a snapshot as client 3.
    const written: EditorOrigin = hyphenated(null, 'stored text');
    if (written.kind !== 'snapshot') throw new Error('expected a snapshot');
    await localDbChatStore(ALICE, db.connection([ALICE]), aloneInBrowser()).saveBase(DOC, { docVersion: CHAT_SYNC.docVersion, snapshot: written.snapshot });
    const clientOf = async (e: EditorSession): Promise<bigint> => ((await e.peerView(await e.awareness())) as PeerView).client;
    const first: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(await textOf(first.editor())).toContain('stored text');
    const firstId: bigint = await clientOf(first.editor());
    await closeAndWrite(first);
    const second: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(await textOf(second.editor())).toContain('stored text');
    const secondId: bigint = await clientOf(second.editor());
    expect([firstId === 3n, secondId === 3n, firstId === secondId]).toEqual([false, false, false]);
  });

  it('refuses a stored copy in another CRDT format, and leaves it as it is', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const store: ChatStoreBackend = localDbChatStore(ALICE, db.connection([ALICE]), aloneInBrowser());
    await store.saveBase(DOC, { docVersion: CHAT_SYNC.docVersion + 1, snapshot: new Uint8Array([1, 2, 3]) });
    const opened: Promise<ChatSide> = openSide(world, ALICE, BOB, db, BLANK);
    await expect(opened).rejects.toBeInstanceOf(ChatSyncError);
    await expect(opened).rejects.toMatchObject({ problem: { kind: 'docVersionMismatch', where: 'the stored copy', received: CHAT_SYNC.docVersion + 1 } });
    expect((await store.loadBase(DOC))?.docVersion).toBe(CHAT_SYNC.docVersion + 1);
  });

  it('refuses a copy or an index written in the earlier, unversioned layout, and leaves both as they are', async () => {
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const port: LocalDbPort = db.connection([ALICE]);
    const base: string = `cdoc-chat:${ALICE.toString()}:${DOC}#base`;
    const index: string = `cdoc-chat:${ALICE.toString()}:#index`;
    const earlierBase: number[] = Array.from(cborEncode({ doc_version: CHAT_SYNC.docVersion, snapshot: new Uint8Array([1]), migration_origin: null }));
    const earlierIndex: number[] = Array.from(cborEncode({ entries: [{ doc_id: DOC, peer_cid: BOB, title: null, held_apart: true }] }));
    await port.set(ALICE, base, earlierBase);
    await port.set(ALICE, index, earlierIndex);
    const store: ChatStoreBackend = localDbChatStore(ALICE, port, aloneInBrowser());
    await expect(store.loadBase(DOC)).rejects.toThrow(/another layout \(store version 1; this client reads 2\)/);
    await expect(store.loadEntry(DOC)).rejects.toThrow(/another layout \(store version 1; this client reads 2\)/);
    expect((await port.get(ALICE, base))?.value).toEqual(earlierBase);
    expect((await port.get(ALICE, index))?.value).toEqual(earlierIndex);
  });

  it('reads back the layout it writes', async () => {
    const store: ChatStoreBackend = localDbChatStore(ALICE, new FakeAgentLocalDb().connection([ALICE]), aloneInBrowser());
    await store.saveBase(DOC, { docVersion: CHAT_SYNC.docVersion, snapshot: new Uint8Array([4, 5]) });
    await store.saveEntry(DOC, { peerCid: BOB, title: null });
    expect(await store.loadBase(DOC)).toEqual({ docVersion: CHAT_SYNC.docVersion, snapshot: new Uint8Array([4, 5]) });
    expect(await store.loadEntry(DOC)).toEqual({ peerCid: BOB, title: null });
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
    const other: ChatStoreBackend = localDbChatStore(BOB, db.connection([BOB]), aloneInBrowser());
    expect(await other.loadBase(DOC)).toBeNull();
    await expect(db.connection([BOB]).get(ALICE, `cdoc-chat:${ALICE.toString()}:${DOC}#base`)).rejects.toThrow(/Refused/);
    expect((): unknown => localDbChatStore(0n, db.connection([0n]), aloneInBrowser())).toThrow(/local account/);
  });
});
