/**
 * Appends and Pulls leave at the kernel's pace (request-pacer.ts), in the order they were made,
 * and none is lost: a burst of typing, a resend after the link comes back, and the pacer's own
 * window boundary. The kernel double refuses past `appends_per_second` per CID per fixed
 * one-second window, as rate_limiter.rs does; the replicas and sessions are production.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentsRequest } from 'citadel-workspace-client-ts';
import type { EditorSession } from '../../editor/editor-session';
import { DOCUMENTS_RELAY_LIMITS } from '../relay-limits';
import { RequestPacer } from '../request-pacer';
import { ALICE, BOB, converged, newDocument, openTab, type Tab } from './doubles/harness';
import { ManualClock } from './doubles/manual-clock';
import { realReplicas, snapshotText, typeInto } from './doubles/real-replicas';
import type { ScriptedKernel } from './doubles/scripted-kernel';

type RealTab = Tab<EditorSession>;
type Sent = { readonly cid: bigint; readonly request: DocumentsRequest; readonly at: number };

/**
 * Three seconds of the kernel's Append budget, typed at once: enough that sending unpaced is
 * refused whatever the configured rate. No run repeats inside it, so a lost edit shows.
 */
const ALPHABET: string = 'KqVxLmNpRtWsYzBcDfGhJk0123456789';
const BURST: string = Array.from({ length: 3 * DOCUMENTS_RELAY_LIMITS.appendsPerSecond }, (_: unknown, i: number): string => ALPHABET[(i * 7 + Math.floor(i / ALPHABET.length)) % ALPHABET.length]).join('');

async function pair(): Promise<{ kernel: ScriptedKernel; clock: ManualClock; alice: RealTab; bob: RealTab }> {
  const { kernel, clock } = await newDocument({});
  const alice: RealTab = openTab(kernel, clock, ALICE, {}, realReplicas(), null);
  const bob: RealTab = openTab(kernel, clock, BOB, {}, realReplicas(), null);
  await alice.session.open();
  await bob.session.open();
  await kernel.settle([alice.session, bob.session]);
  return { kernel, clock, alice, bob };
}

const appendsBy = (kernel: ScriptedKernel, cid: bigint): Sent[] => kernel.requests.filter((r: Sent): boolean => r.cid === cid && 'Append' in r.request);

/** The most requests of `sent` inside any one second. */
function busiestSecond(sent: readonly Sent[]): number {
  return Math.max(0, ...sent.map((first: Sent): number => sent.filter((r: Sent): boolean => r.at >= first.at && r.at < first.at + 1000).length));
}

const clientSeqs = (sent: readonly Sent[]): bigint[] => sent.map((r: Sent): bigint => ('Append' in r.request ? r.request.Append.client_seq : -1n));

describe('the pacer', () => {
  it('lets a window\'s worth go, and holds the next until the window turns', () => {
    const clock: ManualClock = new ManualClock();
    const pacer: RequestPacer = new RequestPacer(clock, DOCUMENTS_RELAY_LIMITS.appendsPerSecond);
    const owner: object = {};
    const fired: number[] = [];
    for (let i: number = 0; i <= DOCUMENTS_RELAY_LIMITS.appendsPerSecond; i += 1) pacer.enqueue(owner, `${i}`, (): boolean => { fired.push(clock.now()); return true; });
    clock.advance(999);
    expect(fired).toHaveLength(DOCUMENTS_RELAY_LIMITS.appendsPerSecond);
    clock.advance(1);
    expect(fired).toHaveLength(DOCUMENTS_RELAY_LIMITS.appendsPerSecond + 1);
  });

  it('spends no slot on a request with nothing left to send, and never queues one twice', () => {
    const clock: ManualClock = new ManualClock();
    const pacer: RequestPacer = new RequestPacer(clock, DOCUMENTS_RELAY_LIMITS.appendsPerSecond);
    const owner: object = {};
    const fired: string[] = [];
    pacer.enqueue(owner, 'sent', (): boolean => { fired.push('sent'); return true; });
    pacer.enqueue(owner, 'answered', (): boolean => { fired.push('answered'); return false; });
    pacer.enqueue(owner, 'next', (): boolean => { fired.push('next'); return true; });
    pacer.enqueue(owner, 'next', (): boolean => { fired.push('duplicate'); return true; });
    // The answered one left no gap: the next went one interval after the first, not two.
    clock.advance(Math.ceil(1000 / DOCUMENTS_RELAY_LIMITS.appendsPerSecond));
    expect(fired).toEqual(['sent', 'answered', 'next']);
    clock.advance(1_000);
    expect(fired).toEqual(['sent', 'answered', 'next']);
    expect(pacer.waiting).toBe(0);
  });
});

describe('typing faster than the kernel admits', () => {
  it('a burst of edits goes in order, never past the window, and every edit arrives', async () => {
    const { kernel, alice, bob } = await pair();
    await typeInto(alice.replica(), BURST);
    await kernel.settle([alice.session, bob.session]);

    const appends: Sent[] = appendsBy(kernel, ALICE);
    expect(kernel.rateRefused).toEqual([]);
    expect(busiestSecond(appends)).toBeLessThanOrEqual(DOCUMENTS_RELAY_LIMITS.appendsPerSecond);
    expect(appends).toHaveLength(BURST.length);
    expect(clientSeqs(appends)).toEqual([...clientSeqs(appends)].sort((a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0)));
    expect(await snapshotText(bob.replica())).toContain(BURST);
    expect(await converged([alice, bob])).toBe(true);
    expect(alice.session.saveInputs.unacknowledged).toBe(0);
  });

  it('edits made while the link was down go again at the same pace when it returns', async () => {
    const { kernel, alice, bob } = await pair();
    kernel.setLink(ALICE, 'down');
    await typeInto(alice.replica(), BURST);
    await kernel.settle([alice.session, bob.session]);
    expect(appendsBy(kernel, ALICE)).toEqual([]);

    kernel.setLink(ALICE, 'up');
    await kernel.settle([alice.session, bob.session]);
    expect(kernel.rateRefused).toEqual([]);
    expect(busiestSecond(appendsBy(kernel, ALICE))).toBeLessThanOrEqual(DOCUMENTS_RELAY_LIMITS.appendsPerSecond);
    expect(await snapshotText(bob.replica())).toContain(BURST);
    expect(alice.problems).toEqual([]);
  });
});
