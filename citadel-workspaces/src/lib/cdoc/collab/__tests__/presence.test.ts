/**
 * Awareness out is paced under the kernel's relay limit and always carries the newest record;
 * peers' awareness in becomes named, coloured carets on the editor's PeerOverlay, re-derived
 * after every repaint, and forgotten once a peer goes quiet. Real replicas and real records.
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import { DOCUMENTS_RELAY_LIMITS } from '../relay-limits';
import { ALICE, BOB, newDocument, openTab, type Tab } from './doubles/harness';
import type { ManualClock } from './doubles/manual-clock';
import { realReplicas, typeInto } from './doubles/real-replicas';
import type { ScriptedKernel } from './doubles/scripted-kernel';

/** Past the pacer's interval twice over, so the next move is sent at once (awareness-pacer.ts). */
const PAST_THE_INTERVAL_MS: number = 2 * Math.ceil(1000 / DOCUMENTS_RELAY_LIMITS.awarenessPerSecond);

type RealTab = Tab<EditorSession>;
type Aware = { readonly cid: bigint; readonly request: { Awareness: { payload: number[] } } };

async function pair(): Promise<{ kernel: ScriptedKernel; clock: ManualClock; alice: RealTab; bob: RealTab }> {
  const { kernel, clock } = await newDocument({});
  const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
  await alice.session.open();
  await bob.session.open();
  await kernel.settle([alice.session, bob.session]);
  return { kernel, clock, alice, bob };
}

const sentBy = (kernel: ScriptedKernel, cid: bigint): Aware[] => kernel.sentOf('Awareness').filter((r: { cid: bigint }): boolean => r.cid === cid) as Aware[];
/** Bob's caret as Alice's page view draws it: null when his position is not in her replica. */
const moveBack = async (replica: EditorSession): Promise<void> => { await replica.execute({ name: 'moveCaret', granularity: 'char', forward: false, extend: false }); };
const bobOnAlice = (alice: RealTab): unknown[] => alice.replica().peers.current.map((p) => p.view.caret);

describe('awareness', () => {
  it('a burst of caret moves never exceeds the relay limit, and the last record sent is the newest', async () => {
    const { kernel, clock, alice, bob } = await pair();
    await typeInto(alice.replica(), 'abcdefghij');
    await kernel.settle([alice.session, bob.session]);
    // Typing took paced time (request-pacer.ts) and sent records of its own; count the burst's.
    const typed: number = sentBy(kernel, ALICE).length;
    for (let move: number = 1; move <= 200; move += 1) {
      await alice.replica().execute({ name: 'moveCaret', granularity: 'char', forward: move % 3 !== 0, extend: false });
      clock.advance(5);
      await kernel.settle([alice.session, bob.session]);
    }
    clock.advance(1_000);
    await kernel.settle([alice.session, bob.session]);
    // A move sent at once, then one inside the pacing interval: only a trailing send carries it.
    // Backwards both times: the burst leaves the caret at the end, where forward moves nothing.
    await moveBack(alice.replica());
    await kernel.settle([alice.session, bob.session]);
    clock.advance(5);
    await moveBack(alice.replica());
    await kernel.settle([alice.session, bob.session]);
    clock.advance(1_000);
    await kernel.settle([alice.session, bob.session]);

    expect(kernel.refusedAwareness).toEqual([]);
    const sent: Aware[] = sentBy(kernel, ALICE);
    // 1 s of moves at the limit, and the two moves after it: never more than allowed.
    expect(sent.length - typed).toBeGreaterThan(DOCUMENTS_RELAY_LIMITS.awarenessPerSecond / 2);
    expect(sent.length - typed).toBeLessThanOrEqual(DOCUMENTS_RELAY_LIMITS.awarenessPerSecond + 3);
    expect(sent[sent.length - 1].request.Awareness.payload).toEqual(Array.from(await alice.replica().awareness()));
  });

  it('draws a peer with its member name and colour, and re-derives it when the page repaints', async () => {
    const { kernel, clock, alice, bob } = await pair();
    await typeInto(bob.replica(), 'abc');
    clock.advance(PAST_THE_INTERVAL_MS);
    await kernel.settle([alice.session, bob.session]);
    expect(alice.peers.at(-1)?.map((p) => ({ name: p.name, color: p.color }))).toEqual([{ name: 'Bob', color: '#10B981' }]);
    expect(bobOnAlice(alice)).toEqual([expect.objectContaining({ page: 0 })]);

    // Bob's next keystroke reaches Alice as awareness only (its push is dropped): his caret
    // names a character her replica does not have, so it cannot be drawn.
    kernel.dropPushesTo(ALICE, 1);
    await typeInto(bob.replica(), 'd');
    await kernel.settle([alice.session, bob.session]);
    expect(bobOnAlice(alice)).toEqual([null]);

    // Alice's own keystroke exposes the gap (her Append lands past the seq she holds), with no
    // new record from Bob: the pulled update repaints her pages, and the SAME record now maps.
    const payloadOf = (r: Aware): readonly number[] => r.request.Awareness.payload;
    const before: readonly number[] = payloadOf(sentBy(kernel, BOB).at(-1) as Aware);
    const recordsBefore: number = sentBy(kernel, BOB).length;
    await typeInto(alice.replica(), 'e');
    await kernel.settle([alice.session, bob.session]);
    // Paced time can let Bob's record go again, unchanged: never a newer one.
    expect(sentBy(kernel, BOB).slice(recordsBefore).map(payloadOf)).toEqual(sentBy(kernel, BOB).slice(recordsBefore).map(() => before));
    expect(bobOnAlice(alice)).toEqual([expect.objectContaining({ page: 0 })]);
  });

  it('moves a peer\'s caret when this replica repaints the page under it, with no new record', async () => {
    const { kernel, clock, alice, bob } = await pair();
    await typeInto(bob.replica(), 'abc');
    clock.advance(PAST_THE_INTERVAL_MS);
    await kernel.settle([alice.session, bob.session]);
    const before: number | undefined = (bobOnAlice(alice)[0] as { rect: { x: number } } | null)?.rect.x;
    // Bob hears nothing more, so he sends no newer record: only Alice's repaint can move him.
    kernel.dropPushesTo(BOB, 100);
    for (let i: number = 0; i < 5; i += 1) await alice.replica().execute({ name: 'moveCaret', granularity: 'char', forward: false, extend: false });
    await typeInto(alice.replica(), 'zz');
    await kernel.settle([alice.session, bob.session]);
    const after: number | undefined = (bobOnAlice(alice)[0] as { rect: { x: number } } | null)?.rect.x;
    expect(before).toBeDefined();
    expect(after).toBeGreaterThan(before ?? Infinity);
  });

  it('keeps a quiet peer alive by heartbeat, and forgets one whose session went away', async () => {
    const { kernel, clock, alice, bob } = await pair();
    await bob.replica().execute({ name: 'selectAll' });
    await kernel.settle([alice.session, bob.session]);
    for (let s: number = 0; s < 30; s += 1) { clock.advance(1_000); await kernel.settle([alice.session, bob.session]); }
    expect(alice.peers.at(-1)?.map((p) => p.name)).toEqual(['Bob']);

    bob.session.close();
    for (let s: number = 0; s < 30; s += 1) { clock.advance(1_000); await kernel.settle([alice.session]); }
    expect(alice.replica().peers.current).toEqual([]);
  });
});
