/**
 * The two people of a chat end up with the same document over their P2P channel alone: as the
 * app opens it (blank on each side), across edits made while the other was not listening,
 * across a reconnect in the middle of a chunked catch-up, and under random interleavings of
 * edits with drops, duplicates and reorders healed by the hello exchange. Real replicas;
 * convergence is byte-equal snapshots and equal model JSON.
 */
import { describe, expect, it } from 'vitest';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC, ENVELOPE_HEADROOM_BYTES } from '../chat-config';
import { ALICE, BLANK, BOB, newWorld, openSide, sameDocument, settle, textOf, type ChatSide, type World } from './doubles/chat-pair';
import { FakeAgentLocalDb } from './doubles/fake-agent-local-db';
import { Rng } from './doubles/rng';

async function bothOpen(world: World): Promise<{ alice: ChatSide; bob: ChatSide }> {
  const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
  const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
  await settle(world, [alice, bob]);
  return { alice, bob };
}

/**
 * `count` paragraphs of `text(i)`, each its own update. Every edit lays out the whole paragraph
 * it lands in, so one paragraph holding all of it makes each later apply pay for all of it.
 */
async function writeParagraphs(side: ChatSide, count: number, text: (i: number) => string): Promise<void> {
  for (let i: number = 0; i < count; i += 1) {
    await side.editor().execute({ name: 'splitParagraph' });
    await side.editor().execute({ name: 'insertText', text: text(i) });
  }
}

describe('a chat document between two peers', () => {
  it('converges on interleaved typing, each side opened blank as the app opens it', async () => {
    const world: World = newWorld();
    const { alice, bob } = await bothOpen(world);
    await typeInto(alice.editor(), 'Hello');
    await typeInto(bob.editor(), 'World');
    await settle(world, [alice, bob]);
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
    expect(await textOf(bob.editor())).toContain('Hello');
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });

  it('catches up on edits made before the other side opened, through the hello exchange', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
    await typeInto(alice.editor(), 'written alone');
    await settle(world, [alice]);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
    await settle(world, [alice, bob]);
    expect(await textOf(bob.editor())).toContain('written alone');
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
  });

  it('answers a hello with one of its own, so the side that opens last also gives what it has', async () => {
    const world: World = newWorld();
    const bobsDevice: FakeAgentLocalDb = new FakeAgentLocalDb();
    const bobAlone: ChatSide = await openSide(world, BOB, ALICE, bobsDevice, BLANK);
    await typeInto(bobAlone.editor(), 'bob wrote this alone');
    await bobAlone.close();
    world.channel.lose();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
    await typeInto(alice.editor(), 'alice too');
    await settle(world, [alice]);
    // Bob opens last: only his hello starts the exchange.
    const bob: ChatSide = await openSide(world, BOB, ALICE, bobsDevice, BLANK);
    await settle(world, [alice, bob]);
    expect(await textOf(alice.editor())).toContain('bob wrote this alone');
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
  });

  it('converges when the link drops in the middle of a chunked catch-up and comes back', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
    // Enough text that the catch-up is several chunks, in paragraphs of their own (see writeParagraphs).
    await writeParagraphs(alice, 16, (i: number): string => `${'paragraph '.repeat(1_200)}${i}`);
    await settle(world, [alice]);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
    await bob.sync().settled();
    // Bob's hello reaches Alice, whose answer is chunked; only its first chunk gets through.
    world.channel.deliver(new Rng(1), { drop: 0, duplicate: 0, reorder: false });
    await alice.sync().settled();
    const diffs: number = world.channel.sent.filter((s): boolean => s.from === ALICE && s.kind === 'diff').length;
    expect(diffs).toBeGreaterThan(2);
    world.channel.deliverFirst(1);
    await bob.sync().settled();
    world.channel.lose();
    world.channel.up = false;
    await settle(world, [alice, bob]);
    expect(await sameDocument(alice.editor(), bob.editor())).toMatchObject({ snapshots: false });
    world.channel.reconnect();
    await settle(world, [alice, bob]);
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });

  it('asks again, with no reconnect, when a lost chunk left the rest waiting', async () => {
    const world: World = newWorld();
    const alice: ChatSide = await openSide(world, ALICE, BOB, new FakeAgentLocalDb(), BLANK);
    await writeParagraphs(alice, 16, (i: number): string => `${'line '.repeat(2_400)}${i}`);
    await settle(world, [alice]);
    const bob: ChatSide = await openSide(world, BOB, ALICE, new FakeAgentLocalDb(), BLANK);
    await bob.sync().settled();
    world.channel.deliver(new Rng(1), { drop: 0, duplicate: 0, reorder: false });
    await alice.sync().settled();
    // Alice's answer starts with its chunks; the first is lost, so what follows waits for it.
    world.channel.dropFirst(1);
    await settle(world, [alice, bob]);
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
    const bobsHellos: number = world.channel.sent.filter((s): boolean => s.from === BOB && s.kind === 'hello').length;
    expect(bobsHellos).toBeGreaterThan(1);
  });

  it('never puts a message over the wire bound: batched updates, and one too large for any message', async () => {
    // Sized from the bound, just past it: two updates that each fit one message but not
    // together, and one paste that fits none.
    const room: number = CHAT_SYNC.maxMessageBytes - ENVELOPE_HEADROOM_BYTES;
    const world: World = newWorld();
    const { alice, bob } = await bothOpen(world);
    await writeParagraphs(alice, 2, (): string => 'x'.repeat(Math.ceil(room * 0.6)));
    // Never sent as an update; Bob is asked to request it, chunked.
    await bob.editor().execute({ name: 'insertText', text: 'y'.repeat(CHAT_SYNC.maxMessageBytes) });
    await settle(world, [alice, bob]);
    const sent = (from: bigint, kind: string): number => world.channel.sent.filter((s): boolean => s.from === from && s.kind === kind).length;
    expect({ aliceUpdates: sent(ALICE, 'update'), bobUpdates: sent(BOB, 'update') }).toEqual({ aliceUpdates: 2, bobUpdates: 0 });
    expect(sent(BOB, 'diff')).toBeGreaterThan(1);
    expect(Math.max(...world.channel.sent.map((s): number => s.bytes))).toBeLessThanOrEqual(CHAT_SYNC.maxMessageBytes);
    expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });
});

describe('random interleavings with drops, duplicates and reorders', () => {
  const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];
  for (const seed of SEEDS) {
    it(`converge after the hello exchange (seed ${seed})`, async () => {
      const rng: Rng = new Rng(seed);
      const world: World = newWorld();
      const { alice, bob } = await bothOpen(world);
      for (let step: number = 0; step < 24; step += 1) {
        const side: ChatSide = rng.chance(0.5) ? alice : bob;
        const action: number = rng.int(10);
        if (action < 5) await typeInto(side.editor(), rng.pick(['a', 'bc', 'def ', 'Ü', '中文']));
        else if (action < 7) await side.editor().execute({ name: 'deleteBackward', unit: 'char' });
        else if (action < 8) await side.editor().execute({ name: 'splitParagraph' });
        else if (action < 9) world.channel.reconnect();
        else {
          world.clock.advance(CHAT_SYNC.updateCoalesceMs);
          world.channel.deliver(rng, { drop: 0.3, duplicate: 0.2, reorder: true });
        }
        await Promise.all([alice.sync().settled(), bob.sync().settled()]);
      }
      await settle(world, [alice, bob], rng, { drop: 0.3, duplicate: 0.2, reorder: true });
      world.channel.reconnect();
      await settle(world, [alice, bob]);
      expect(await sameDocument(alice.editor(), bob.editor())).toEqual({ snapshots: true, models: true });
      expect([...alice.problems, ...bob.problems]).toEqual([]);
    }, 60_000);
  }
});
