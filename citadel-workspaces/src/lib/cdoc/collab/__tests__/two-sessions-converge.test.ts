/**
 * Two people editing one document end up with the same document: through the relay, across a
 * dropped push, across a link drop with edits made offline, and with two tabs of one account,
 * whose own updates the server never pushes to them. Real replicas (the production editor over
 * the vendored engine); convergence is byte-equal snapshots.
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import { ALICE, BOB, converged, newDocument, newKernel, openTab, type Tab } from './doubles/harness';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';
import type { ScriptedKernel } from './doubles/scripted-kernel';

type RealTab = Tab<EditorSession>;

async function bothOpen(): Promise<{ kernel: ScriptedKernel; alice: RealTab; bob: RealTab }> {
  const { kernel, clock } = await newDocument({});
  const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
  await alice.session.open();
  await bob.session.open();
  await kernel.settle([alice.session, bob.session]);
  return { kernel, alice, bob };
}

const pullsOf = (kernel: ScriptedKernel, cid: bigint): bigint[] =>
  kernel.sentOf('Pull').filter((r: { cid: bigint }): boolean => r.cid === cid).map((r: { request: { Pull: { since_seq: bigint } } }): bigint => r.request.Pull.since_seq);

describe('two sessions on one document', () => {
  it('converge on a new document each opened blank on its own, as the app opens one', async () => {
    const { kernel, clock } = newKernel({});
    const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await alice.session.open();
    await bob.session.open();
    await kernel.settle([alice.session, bob.session]);
    expect([alice.sources, bob.sources]).toEqual([[{ kind: 'blank' }], [{ kind: 'blank' }]]);
    await typeInto(alice.replica(), 'Hello');
    await typeInto(bob.replica(), 'World');
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);
    expect(await snapshotText(bob.replica())).toContain('Hello');
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });

  it('converge on interleaved typing through the relay', async () => {
    const { kernel, alice, bob } = await bothOpen();
    await typeInto(alice.replica(), 'Hello');
    await typeInto(bob.replica(), 'World');
    await typeInto(alice.replica(), '!');
    await kernel.settle([alice.session, bob.session]);

    expect(await converged([alice, bob])).toBe(true);
    const text: string = await snapshotText(bob.replica());
    expect(text).toContain('Hello!');
    expect(text).toContain('World');
    expect([alice.session.seq, bob.session.seq]).toEqual([12n, 12n]);
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });

  it('applies its own update once: the Appended is not applied again from a pull', async () => {
    const { kernel, alice, bob } = await bothOpen();
    await typeInto(alice.replica(), 'abc');
    await kernel.settle([alice.session, bob.session]);
    expect(pullsOf(kernel, ALICE)).toEqual([0n]);
    expect(await snapshotText(alice.replica())).toContain('abc');
  });

  it('closes a gap left by a dropped push by pulling from the last seq it holds', async () => {
    const { kernel, alice, bob } = await bothOpen();
    await typeInto(alice.replica(), 'ab');
    await kernel.settle([alice.session, bob.session]);
    kernel.dropPushesTo(BOB, 2);
    await typeInto(alice.replica(), 'cde');
    await kernel.settle([alice.session, bob.session]);

    expect(pullsOf(kernel, BOB)).toEqual([0n, 3n]);
    expect(await snapshotText(bob.replica())).toContain('abcde');
    expect(bob.session.seq).toBe(6n);
  });

  it('after a reconnect, sends what was typed offline and pulls what it missed', async () => {
    const { kernel, alice, bob } = await bothOpen();
    kernel.setLink(ALICE, 'down');
    await typeInto(alice.replica(), 'xy');
    await typeInto(bob.replica(), '12');
    await kernel.settle([alice.session, bob.session]);
    expect(kernel.sentOf('Append').filter((r: { cid: bigint }): boolean => r.cid === ALICE)).toHaveLength(0);

    kernel.setLink(ALICE, 'up');
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);
    const text: string = await snapshotText(alice.replica());
    expect(text).toContain('xy');
    expect(text).toContain('12');
  });

  it('two tabs of one account converge although the server pushes neither the other\'s updates', async () => {
    const { kernel, clock } = await newDocument({});
    const tab1: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    const tab2: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    const all: RealTab[] = [tab1, tab2, bob];
    for (const tab of all) await tab.session.open();
    await kernel.settle(all.map((t: RealTab) => t.session));

    // Tab 2 types nothing yet: only tab 1's Appended answers, which reach both tabs of the
    // session, can tell it that the log moved.
    await typeInto(tab1.replica(), 'one');
    await kernel.settle(all.map((t: RealTab) => t.session));
    expect(await snapshotText(tab2.replica())).toContain('one');

    await typeInto(tab2.replica(), 'two');
    await kernel.settle(all.map((t: RealTab) => t.session));
    expect(await converged(all)).toBe(true);
    expect(await snapshotText(bob.replica())).toContain('two');
  });
});
