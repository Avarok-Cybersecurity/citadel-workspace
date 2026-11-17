/**
 * Requests the server refuses for now are retried, not lost and not reported while they keep
 * going through: a full log resends on the server's DocumentCompacted (or by the bounded
 * fallback), rate-limited Appends and Pulls back off, and a refusal that persists past the
 * retries is reported once, by name. Real replicas, real refusal shapes.
 */
import { describe, expect, it } from 'vitest';
import type { EditorSession } from '../../editor/editor-session';
import { refusalName } from '../session-errors';
import { SENDING_PAUSED_TEXT } from '@/lib/document-save/save-status-text';
import { ALICE, BOB, converged, newDocument, openTab, type Tab } from './doubles/harness';
import type { ManualClock } from './doubles/manual-clock';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';
import type { ScriptedKernel } from './doubles/scripted-kernel';

type RealTab = Tab<EditorSession>;

async function pair(): Promise<{ kernel: ScriptedKernel; clock: ManualClock; alice: RealTab; bob: RealTab }> {
  const { kernel, clock } = await newDocument({});
  const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
  await alice.session.open();
  await bob.session.open();
  await kernel.settle([alice.session, bob.session]);
  return { kernel, clock, alice, bob };
}

const named = (tab: RealTab): string[] => tab.problems.map((p) => (p.problem.kind === 'refused' ? refusalName(p.problem.refusal) : p.problem.kind));

describe('a request the server refuses for now', () => {
  it('a full log: the dropped update goes again when the server compacts', async () => {
    const { kernel, alice, bob } = await pair();
    kernel.holdBack(ALICE, 'LogFull', 1);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(false);
    kernel.compact();
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);
    expect(kernel.sentOf('Append')).toHaveLength(2);
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });

  it('a full log the server never announces compacted: the bounded retry sends it', async () => {
    const { kernel, clock, alice, bob } = await pair();
    kernel.holdBack(ALICE, 'LogFull', 1);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session, bob.session]);
    clock.advance(1_000);
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);

    // Gone through, so the next full log starts with the whole budget again: 1 s, not 3.
    kernel.holdBack(ALICE, 'LogFull', 1);
    await typeInto(alice.replica(), 'b');
    await kernel.settle([alice.session, bob.session]);
    clock.advance(1_000);
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);
    expect(alice.problems).toEqual([]);
  });

  it('a rate limit that persists: three retries over ten seconds, reported once as paused, and retried on', async () => {
    const { kernel, clock, alice, bob } = await pair();
    kernel.holdBack(ALICE, 'AppendRateLimited', 100);
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session, bob.session]);
    for (let s: number = 0; s < 10; s += 1) { clock.advance(1_000); await kernel.settle([alice.session, bob.session]); }
    expect(kernel.sentOf('Append')).toHaveLength(4);
    expect(named(alice)).toEqual(['AppendRateLimited']);
    expect(alice.problems.map((p) => p.message)).toEqual([SENDING_PAUSED_TEXT]);

    // Still retrying at the last delay and refused again, not reported again; it goes when the
    // server takes it.
    for (let s: number = 0; s < 6; s += 1) { clock.advance(1_000); await kernel.settle([alice.session, bob.session]); }
    expect(kernel.sentOf('Append')).toHaveLength(5);
    expect(alice.problems).toHaveLength(1);
    kernel.holdBack(ALICE, 'AppendRateLimited', 0);
    for (let s: number = 0; s < 6; s += 1) { clock.advance(1_000); await kernel.settle([alice.session, bob.session]); }
    expect(kernel.sentOf('Append')).toHaveLength(6);
    expect(await converged([alice, bob])).toBe(true);
    expect(alice.problems).toHaveLength(1);
  });

  it('a rate-limited Pull: pulled again after the back-off, unreported', async () => {
    const { kernel, clock } = await newDocument({});
    const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
    await alice.session.open();
    await kernel.settle([alice.session]);
    await typeInto(alice.replica(), 'hello');
    await kernel.settle([alice.session]);
    kernel.holdBack(BOB, 'PullRateLimited', 1);
    const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
    await bob.session.open();
    await kernel.settle([alice.session, bob.session]);
    clock.advance(1_000);
    await kernel.settle([alice.session, bob.session]);
    expect(await snapshotText(bob.replica())).toContain('hello');
    expect(kernel.sentOf('Pull').filter((r: { cid: bigint }): boolean => r.cid === BOB)).toHaveLength(2);
    expect(bob.problems).toEqual([]);
  });

  it('a compaction with nothing held back changes nothing, unless it shows this replica is behind', async () => {
    const { kernel, alice, bob } = await pair();
    await typeInto(alice.replica(), 'a');
    await kernel.settle([alice.session, bob.session]);
    const appends: number = kernel.sentOf('Append').length;
    const pulls: number = kernel.sentOf('Pull').length;
    kernel.compact();
    await kernel.settle([alice.session, bob.session]);
    expect([kernel.sentOf('Append').length, kernel.sentOf('Pull').length]).toEqual([appends, pulls]);

    kernel.dropPushesTo(BOB, 1);
    await typeInto(alice.replica(), 'b');
    await kernel.settle([alice.session, bob.session]);
    kernel.compact();
    await kernel.settle([alice.session, bob.session]);
    expect(await converged([alice, bob])).toBe(true);
    expect([...alice.problems, ...bob.problems]).toEqual([]);
  });
});
