/**
 * Edits and renames the peer sends while this side has the document closed are recorded on
 * this device, so it opens with them though the peer has gone offline since. Only for a
 * document this account keeps, in the chat with that peer, and never while it is open here
 * (its keeper records then, and two writers would overwrite each other).
 */
import { describe, expect, it } from 'vitest';
import type { CdocChatCommandEvent, CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC } from '../chat-config';
import { recordClosedDocumentCommand, type InboxOutcome } from '../chat-inbox';
import { localDbChatStore } from '../chat-local-db';
import type { ChatStoreBackend } from '../chat-ports';
import { ALICE, BLANK, BOB, newWorld, openSide, settle, textOf, type ChatSide, type World } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';

/** What bindChatDocumentInbox does in the app: every command Alice's session hears goes to the inbox. */
function inboxFor(world: World, db: FakeAgentLocalDb): { readonly outcomes: Promise<InboxOutcome>[]; readonly store: ChatStoreBackend } {
  const store: ChatStoreBackend = localDbChatStore(ALICE, db.connection([ALICE]));
  const outcomes: Promise<InboxOutcome>[] = [];
  world.channel.transport(ALICE, BOB).onMessage((payload: CdocChatSyncPayload): void => {
    const event: CdocChatCommandEvent = { peerCid: BOB, recipientCid: ALICE, payload };
    outcomes.push(recordClosedDocumentCommand(ALICE, event, store, CHAT_SYNC));
  });
  return { outcomes, store };
}

describe('a closed chat document', () => {
  it('records the peer\'s edits and rename, and reopens with them while the peer is offline', async () => {
    const world: World = newWorld();
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
    await settle(world, [alice, bob]);
    const inbox: { readonly outcomes: Promise<InboxOutcome>[] } = inboxFor(world, db);
    await typeInto(bob.editor(), 'while alice was away');
    await settle(world, [alice, bob]);
    expect(await Promise.all(inbox.outcomes.splice(0))).toContain('open here');
    await alice.close();
    await typeInto(bob.editor(), ' and after she closed it');
    bob.sync().rename('Renamed while closed');
    await settle(world, [bob]);
    const outcomes: InboxOutcome[] = await Promise.all(inbox.outcomes);
    expect(outcomes).toContain('recorded');
    expect(outcomes).toContain('renamed');
    world.channel.up = false;
    const again: ChatSide = await openSide(world, ALICE, BOB, db, BLANK);
    expect(await textOf(again.editor())).toContain('while alice was away and after she closed it');
    expect(again.titles.at(-1)?.title).toBe('Renamed while closed');
  });

  it('records nothing for a document this account does not keep, or keeps in another chat', async () => {
    // A document no test here has open (the open set is the tab's, shared by every test in it).
    const doc: string = 'chat-doc-never-opened';
    const db: FakeAgentLocalDb = new FakeAgentLocalDb();
    const store: ChatStoreBackend = localDbChatStore(ALICE, db.connection([ALICE]));
    const update: CdocChatSyncPayload = { doc_id: doc, doc_version: CHAT_SYNC.docVersion, sync: { kind: 'update', updates: [new Uint8Array([1, 2])] } };
    expect(await recordClosedDocumentCommand(ALICE, { peerCid: BOB, recipientCid: ALICE, payload: update }, store, CHAT_SYNC)).toBe('not kept');
    await store.saveEntry(doc, { peerCid: BOB, title: null, heldApart: false });
    const stranger: bigint = BOB + 7n;
    expect(await recordClosedDocumentCommand(ALICE, { peerCid: stranger, recipientCid: ALICE, payload: update }, store, CHAT_SYNC)).toBe('not kept');
    expect(await recordClosedDocumentCommand(ALICE, { peerCid: BOB, recipientCid: ALICE, payload: { ...update, doc_version: CHAT_SYNC.docVersion + 1 } }, store, CHAT_SYNC)).toBe('refused');
    expect(await store.loadPending(doc)).toEqual([]);
    expect(await recordClosedDocumentCommand(ALICE, { peerCid: BOB, recipientCid: ALICE, payload: update }, store, CHAT_SYNC)).toBe('recorded');
    expect((await store.loadPending(doc)).map((u: Uint8Array): number[] => Array.from(u))).toEqual([[1, 2]]);
  });
});
