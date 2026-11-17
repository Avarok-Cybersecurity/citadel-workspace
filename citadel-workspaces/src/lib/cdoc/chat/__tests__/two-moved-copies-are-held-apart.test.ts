/**
 * A chat document both people moved to Citadel Docs: when both moved the same original (the
 * same Yjs state, so the same snapshot bytes) the copies converge as usual; when they moved
 * different originals the two copies are never merged (each migration is its own client's,
 * so a merge would hold the document twice). Nothing more is exchanged, either way, the
 * person is told, and the copy stays held apart when it is reopened: the inbox records
 * nothing for it while it is closed, and only hellos leave it, so a peer that did not know learns. Real replicas; only the channel, LocalDB and time fake.
 */
import { describe, expect, it } from 'vitest';
import * as glue from '../../../../../vendor/cdoc/cdoc_wasm_editor.js';
import type { CdocChatCommandEvent, CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { pmWithText, realWasm } from '../../__tests__/wasm-rig';
import { CHAT_SYNC } from '../chat-config';
import { encodeChatSync } from '../chat-wire';
import { recordClosedDocumentCommand, type InboxOutcome } from '../chat-inbox';
import { localDbChatStore } from '../chat-local-db';
import type { ChatDocumentOrigin } from '../chat-replica-keeper';
import { ALICE, BOB, DOC, newWorld, openSide, sameDocument, settle, textOf, type ChatSide, type World } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';
import type { ChatTransport } from '../chat-ports';

/** A migration of `text`, written as `client`, as live-doc-migration's runner writes one. */
function moved(text: string, client: bigint, migrationOrigin: string): ChatDocumentOrigin {
  realWasm();
  const migrated: glue.Migrated = glue.pm_to_crdt_snapshot(pmWithText(text), client);
  try {
    return { kind: 'migrated', snapshot: migrated.snapshot(), migrationOrigin };
  } finally {
    migrated.free();
  }
}

const SAME: string = 'a'.repeat(64);
const OTHER: string = 'b'.repeat(64);

describe('two copies moved to Citadel Docs', () => {
  it('converge when both were moved from the same original, what came before the hello included', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), moved('The plan', 11n, SAME));
    await typeInto(alice.editor(), ' — alice edits first');
    await settle(world, [alice]);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('The plan', 11n, SAME));
    await settle(world, [alice, bob]);
    expect(await textOf(bob.editor())).toContain('alice edits first');
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
    expect([...alice.problems, ...bob.problems, ...alice.heldApart, ...bob.heldApart]).toEqual([]);
    await Promise.all([alice.close(), bob.close()]);
  });

  it('are held apart when moved from different originals: neither takes the other in, both are told', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), moved('Alice version', 11n, SAME));
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('Bob version', 12n, OTHER));
    await settle(world, [alice, bob]);
    const sentBefore: number = world.channel.sent.length;
    await typeInto(bob.editor(), ' typed after');
    await settle(world, [alice, bob]);
    expect(await textOf(alice.editor())).not.toContain('Bob version');
    expect(await textOf(bob.editor())).not.toContain('Alice version');
    expect(await textOf(alice.editor())).not.toContain('typed after');
    expect(world.channel.sent.slice(sentBefore)).toEqual([]);
    expect(world.channel.sent.some((s) => s.kind === 'diff')).toBe(false);
    expect(alice.heldApart).toEqual([OTHER]);
    expect(bob.heldApart).toEqual([SAME]);
    expect(alice.problems).toEqual([{ kind: 'migrationMismatch', ours: SAME, theirs: OTHER }]);
    expect(bob.problems).toEqual([{ kind: 'migrationMismatch', ours: OTHER, theirs: SAME }]);
    await Promise.all([alice.close(), bob.close()]);
  });

  it('tells a peer that did not know: a copy held apart answers a hello with its own, and nothing else', async () => {
    const world: World = newWorld();
    const aliceDb: FakeAgentLocalDb = new FakeAgentLocalDb();
    const first: ChatSide = await openSide(world, ALICE, BOB, aliceDb, moved('Alice version', 11n, SAME));
    const bobBefore: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('Bob version', 12n, OTHER));
    await settle(world, [first, bobBefore]);
    await Promise.all([first.close(), bobBefore.close()]);
    world.channel.lose();
    // Alice reopens a copy held apart; Bob comes back on a new device that never heard about it.
    const alice: ChatSide = await openSide(world, ALICE, BOB, aliceDb, moved('Alice version', 11n, SAME));
    await alice.sync().settled();
    world.channel.lose(); // Bob was not there for Alice's own hello: only her answer to his can tell him.
    const sentBefore: number = world.channel.sent.length;
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('Bob version', 12n, OTHER));
    await settle(world, [alice, bob]);
    expect(bob.heldApart).toEqual([SAME]);
    expect(alice.heldApart).toEqual([]);
    expect(new Set(world.channel.sent.slice(sentBefore).filter((s) => s.from === ALICE).map((s) => s.kind))).toEqual(new Set(['hello']));
    expect(await textOf(bob.editor())).not.toContain('Alice version');
    await Promise.all([alice.close(), bob.close()]);
  });

  it('applies nothing a peer sends once held apart, even its whole copy as a diff', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), moved('Alice version', 11n, SAME));
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('Bob version', 12n, OTHER));
    await settle(world, [alice, bob]);
    // What a peer that did not hold its copy apart would send: everything Alice lacks.
    const chunks: Uint8Array[] = await bob.editor().encodeDiffChunked(await alice.editor().stateVector(), CHAT_SYNC.maxChunkBytes);
    const bobs: ChatTransport = world.channel.transport(BOB, ALICE);
    for (const [index, chunk] of chunks.entries()) {
      await bobs.send(encodeChatSync({ doc_id: DOC, doc_version: CHAT_SYNC.docVersion, sync: { kind: 'diff', chunk, index, count: chunks.length } }));
    }
    await settle(world, [alice, bob]);
    expect(await textOf(alice.editor())).not.toContain('Bob version');
    await Promise.all([alice.close(), bob.close()]);
  });

  it('holds a moved copy apart from a copy that was never moved', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), moved('Alice version', 11n, SAME));
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), { kind: 'blank' });
    await typeInto(bob.editor(), 'Bob typed into a new one');
    await settle(world, [alice, bob]);
    expect(await textOf(alice.editor())).not.toContain('Bob typed');
    expect(alice.heldApart).toEqual([null]);
    await Promise.all([alice.close(), bob.close()]);
  });

  it('stay apart after a reopen: the inbox records nothing for it, and the reopened copy sends nothing', async () => {
    const world: World = newWorld();
    const aliceDb: FakeAgentLocalDb = new FakeAgentLocalDb();
    const alice: ChatSide = await openSide(world, ALICE, BOB, aliceDb, moved('Alice version', 11n, SAME));
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), moved('Bob version', 12n, OTHER));
    await settle(world, [alice, bob]);
    await alice.close();
    const outcomes: Promise<InboxOutcome>[] = [];
    world.channel.transport(ALICE, BOB).onMessage((payload: CdocChatSyncPayload): void => {
      const event: CdocChatCommandEvent = { peerCid: BOB, recipientCid: ALICE, payload };
      outcomes.push(recordClosedDocumentCommand(ALICE, event, localDbChatStore(ALICE, aliceDb.connection([ALICE])), CHAT_SYNC));
    });
    // Bob's copy is held apart too, so it sends nothing; what a peer on an older build would send is refused all the same.
    const update: CdocChatSyncPayload = { doc_id: DOC, doc_version: CHAT_SYNC.docVersion, sync: { kind: 'update', updates: [new Uint8Array([1, 2])] } };
    expect(await recordClosedDocumentCommand(ALICE, { peerCid: BOB, recipientCid: ALICE, payload: update }, localDbChatStore(ALICE, aliceDb.connection([ALICE])), CHAT_SYNC)).toBe('held apart');
    await typeInto(bob.editor(), ' while alice was away');
    await settle(world, [bob]);
    expect(await Promise.all(outcomes)).not.toContain('recorded');
    const sentBefore: number = world.channel.sent.length;
    const again: ChatSide = await openSide(world, ALICE, BOB, aliceDb, moved('Alice version', 11n, SAME));
    await typeInto(again.editor(), ' and more');
    await settle(world, [again, bob]);
    expect(new Set(world.channel.sent.slice(sentBefore).map((s) => s.kind))).toEqual(new Set(['hello']));
    expect(await textOf(again.editor())).toContain('Alice version');
    expect(await textOf(again.editor())).toContain(' and more');
    expect(await textOf(again.editor())).not.toContain('Bob version');
  });
});
