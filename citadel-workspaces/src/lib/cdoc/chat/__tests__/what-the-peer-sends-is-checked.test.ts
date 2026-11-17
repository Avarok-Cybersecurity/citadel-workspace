/**
 * What arrives from the peer is checked before anything is applied: a payload in another CRDT
 * format is refused and reported, never applied; one that is not in the shape this client
 * writes is reported. Titles are last-writer-wins, and a lost rename is healed by the next
 * hello. Carets cross the P2P channel through the shared presence code and are drawn.
 */
import { describe, expect, it } from 'vitest';
import type { CdocChatSync } from '@/types/cdoc-chat-sync';
import type { PeerPresence } from '../../editor/peer-overlay';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC } from '../chat-config';
import { encodeChatSync } from '../chat-wire';
import { ALICE, BLANK, BOB, DOC, newWorld, openSide, settle, textOf, type ChatSide, type World } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';
import { CLEAN } from './doubles/fake-channel';
import { Rng } from './doubles/rng';

async function bothOpen(world: World): Promise<{ alice: ChatSide; bob: ChatSide }> {
  const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
  const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
  await settle(world, [alice, bob]);
  return { alice, bob };
}

/** Bob's next local edit, captured as it is made (the test decides how it travels). */
async function bobsUpdate(bob: ChatSide, text: string): Promise<Uint8Array> {
  const captured: Promise<Uint8Array> = new Promise<Uint8Array>((resolve: (u: Uint8Array) => void): void => {
    const off: () => void = bob.editor().on('change', ({ update }: { readonly update: Uint8Array }): void => { off(); resolve(update); });
  });
  await bob.editor().execute({ name: 'insertText', text });
  return captured;
}

function sendAsBob(world: World, docVersion: number, sync: CdocChatSync): Promise<void> {
  return world.channel.transport(BOB, ALICE).send(encodeChatSync({ doc_id: DOC, doc_version: docVersion, sync }));
}

describe('a payload from the peer', () => {
  it('in another CRDT format is refused and reported, never applied', async () => {
    const world: World = newWorld();
    const { alice, bob } = await bothOpen(world);
    world.channel.up = false;
    const update: Uint8Array = await bobsUpdate(bob, 'FORMAT');
    world.channel.up = true;
    await sendAsBob(world, CHAT_SYNC.docVersion + 1, { kind: 'update', updates: [update] });
    world.channel.deliver(new Rng(1), CLEAN);
    await alice.sync().settled();
    expect(alice.problems).toEqual([{ kind: 'docVersionMismatch', expected: CHAT_SYNC.docVersion, received: CHAT_SYNC.docVersion + 1, where: 'the peer' }]);
    expect(await textOf(alice.editor())).not.toContain('FORMAT');
    // The same bytes in this client's format are applied: the refusal was the version, not the update.
    await sendAsBob(world, CHAT_SYNC.docVersion, { kind: 'update', updates: [update] });
    world.channel.deliver(new Rng(1), CLEAN);
    await alice.sync().settled();
    expect(await textOf(alice.editor())).toContain('FORMAT');
  });

  it('not in the shape this client writes is reported and changes nothing', async () => {
    const world: World = newWorld();
    const { alice } = await bothOpen(world);
    const before: Uint8Array = await alice.editor().snapshot();
    const malformed: CdocChatSync = { kind: 'diff', chunk: new Uint8Array([1]), index: 3, count: 2 };
    await sendAsBob(world, CHAT_SYNC.docVersion, malformed);
    world.channel.deliver(new Rng(1), CLEAN);
    await alice.sync().settled();
    expect(alice.problems.map((p): string => p.kind)).toEqual(['unreadable']);
    expect(Array.from(await alice.editor().snapshot())).toEqual(Array.from(before));
  });
});

describe('the title', () => {
  it('is the later rename on both sides, and a lost rename is healed by the next hello', async () => {
    const world: World = newWorld();
    const { alice, bob } = await bothOpen(world);
    alice.sync().rename('First');
    world.clock.advance(10);
    bob.sync().rename('Second');
    await settle(world, [alice, bob]);
    expect([alice.titles.at(-1)?.title, bob.titles.at(-1)?.title]).toEqual(['Second', 'Second']);
    // Lost on the way: the rename message never arrives; the reconnect's hello carries it.
    world.channel.up = false;
    world.clock.advance(10);
    alice.sync().rename('Third');
    await settle(world, [alice, bob]);
    expect(bob.titles.at(-1)?.title).toBe('Second');
    world.channel.reconnect();
    await settle(world, [alice, bob]);
    expect(bob.titles.at(-1)?.title).toBe('Third');
    expect((): unknown => alice.sync().rename('   ')).toThrow(/title/);
  });
});

describe('presence over the P2P channel', () => {
  it('draws the peer\'s caret on this replica\'s pages', async () => {
    const world: World = newWorld();
    const { alice, bob } = await bothOpen(world);
    await typeInto(alice.editor(), 'caret here');
    await settle(world, [alice, bob]);
    const drawn: readonly PeerPresence[] = bob.editor().peers.current;
    expect(drawn.map((p): string => p.name)).toEqual(['Peer']);
    expect(drawn[0].view.caret).not.toBeNull();
    expect(world.channel.sent.some((s): boolean => s.from === ALICE && s.kind === 'awareness')).toBe(true);
  });
});
