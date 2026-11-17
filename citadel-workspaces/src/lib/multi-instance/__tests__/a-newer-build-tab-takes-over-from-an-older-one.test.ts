/**
 * Among tabs of this protocol, the newest build leads; tabs of one build keep the leader they
 * have.
 *
 * A tab left open across a deploy runs code the server no longer serves, and the agent may
 * already speak the newer build's language. So when a newer tab opens, the older leader hands
 * over -- after answering the requests it is executing, so none is lost -- and, being stale,
 * never stands again. Within one build nothing moves: a second tab follows the first.
 *
 * See two-builds-harness.ts for what is real and what is stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERVAL } from '../../timeout-constants';
import { closeAllTabs, leaders, livelocked, openTab, type Tab } from './two-builds-harness';
import type { AckResult } from '../outbound-queue';

const OLD_SEQ: number = 1_700_000_000;
const NEW_SEQ: number = 1_700_090_000;
const OBSERVE_MS: number = 60_000;
/** A request the old leader is still executing when the newer tab opens. */
const SLOW_REQUEST_MS: number = 3000;

beforeEach((): void => { vi.useFakeTimers(); localStorage.clear(); });
afterEach((): void => { closeAllTabs(); vi.useRealTimers(); });

async function settledLeader(name: string, seq: number): Promise<Tab> {
  const tab: Tab = await openTab(name, 'proto2', seq, 31n);
  await vi.advanceTimersByTimeAsync(INTERVAL.HEARTBEAT_MS * 3);
  expect(tab.manager.isLeader).toBe(true);
  return tab;
}

describe('tabs of one build', () => {
  it('keep the leader they have, with one socket, and nobody changes id', async () => {
    const first: Tab = await settledLeader('first', OLD_SEQ);
    const firstId: string = first.manager.instanceId;
    const second: Tab = await openTab('second', 'proto2', OLD_SEQ, 32n);
    const secondId: string = second.manager.instanceId;

    await vi.advanceTimersByTimeAsync(OBSERVE_MS);

    expect(livelocked(), 'the tabs answered each other without end').toBe(false);
    expect(leaders()).toEqual([first]);
    expect(second.manager.leaderId).toBe(firstId);
    expect([first.manager.instanceId, second.manager.instanceId], 'an id changed: the tabs took each other for an old build').toEqual([firstId, secondId]);
    expect(first.socketsOpened + second.socketsOpened).toBe(1);
    expect(first.socketsClosed).toBe(0);
  });

  it('do not hand over to each other, however many there are', async () => {
    const first: Tab = await settledLeader('first', OLD_SEQ);
    await openTab('second', 'proto2', OLD_SEQ, 32n);
    await openTab('third', 'proto2', OLD_SEQ, 33n);

    await vi.advanceTimersByTimeAsync(OBSERVE_MS);

    expect(leaders()).toEqual([first]);
    expect(first.promotions).toBe(1);
    expect(first.staleness?.getTabStaleness().stale).toBe(false);
  });
});

describe('a newer build opened beside an older leader', () => {
  /** The old leader, a follower of its build with a slow request in flight, then a newer tab. */
  async function newerTabDuringARequest(): Promise<{ old: Tab; follower: Tab; newer: Tab; answer: Promise<AckResult> }> {
    const old: Tab = await settledLeader('old', OLD_SEQ);
    old.sendTakesMs = SLOW_REQUEST_MS;
    const follower: Tab = await openTab('follower', 'proto2', OLD_SEQ, 32n);
    await vi.advanceTimersByTimeAsync(INTERVAL.HEARTBEAT_MS);
    const answer: Promise<AckResult> = follower.channel.sendToLeader({ GetSessions: { request_id: 'slow' } }, 'slow');
    await vi.advanceTimersByTimeAsync(100);
    const newer: Tab = await openTab('newer', 'proto2', NEW_SEQ, 33n);
    return { old, follower, newer, answer };
  }

  it('is not handed leadership while the old leader is still answering a request', async () => {
    const { old, newer } = await newerTabDuringARequest();

    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS / 2);

    expect(old.manager.isLeader).toBe(true);
    expect(newer.manager.isLeader).toBe(false);
    expect(old.staleness?.getTabStaleness().stale).toBe(true);
  });

  it('leads once that request is answered, and the old tabs never lead again', async () => {
    const { old, follower, newer, answer } = await newerTabDuringARequest();

    await vi.advanceTimersByTimeAsync(OBSERVE_MS);

    await expect(answer).resolves.toMatchObject({ status: 'processed' });
    expect(old.sent).toEqual([{ GetSessions: { request_id: 'slow' } }]);
    expect(leaders()).toEqual([newer]);
    expect(newer.promotions).toBe(1);
    expect(newer.socketsOpened).toBe(1);
    expect(old.socketsClosed).toBe(1);
    expect(old.promotions, 'the stale leader stood again after handing over').toBe(1);
    expect(follower.promotions).toBe(0);
    expect(follower.manager.leaderId).toBe(newer.manager.instanceId);
  });
});
