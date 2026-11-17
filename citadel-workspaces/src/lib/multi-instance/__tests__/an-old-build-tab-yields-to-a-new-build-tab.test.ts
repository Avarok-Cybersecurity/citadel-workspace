/**
 * A tab of the build before the channel envelope (protocol 1) and a tab of this build agree on
 * one leader: this one, with one socket, at once, for good.
 *
 * People keep tabs open across deploys. An old-build tab and a new-build tab that broke
 * election ties by opposite rules each won by its own rule and lost by the other's, so
 * leadership -- and the browser's one socket to the agent -- went back and forth for as long
 * as both were open: a reconnect every few seconds, and sessions claimed by whichever tab
 * held the socket that moment.
 *
 * The old tab is the frozen copy of that build's election and dispatch
 * (fixtures/legacy-v1, provenance.ts); the new tab is this build. See two-builds-harness.ts for
 * what is real and what is stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERVAL } from '../../timeout-constants';
import { closeAllTabs, leaders, livelocked, openTab, SOCKET_OPEN_MS, type Tab } from './two-builds-harness';
import type { AckResult } from '../outbound-queue';

const OLD_SEQ: number = 1_700_000_000;
const NEW_SEQ: number = 1_700_090_000;
/** Long enough for any flapping to show many times over. */
const OBSERVE_MS: number = 60_000;

beforeEach((): void => { vi.useFakeTimers(); localStorage.clear(); });
afterEach((): void => { closeAllTabs(); vi.useRealTimers(); });

/** An old-build tab that has led for a while, then a new-build tab opened beside it. */
async function oldLeaderThenNewTab(): Promise<{ old: Tab; fresh: Tab }> {
  const old: Tab = await openTab('old', 'legacy', OLD_SEQ, 11n);
  await vi.advanceTimersByTimeAsync(INTERVAL.HEARTBEAT_MS * 3);
  expect(old.manager.isLeader).toBe(true);
  expect(old.socketsOpened).toBe(1);
  const fresh: Tab = await openTab('new', 'proto2', NEW_SEQ, 22n);
  await vi.advanceTimersByTimeAsync(OBSERVE_MS);
  return { old, fresh };
}

describe('an old-build tab and a new-build tab', () => {
  it('end with the new tab leading and the old one following it', async () => {
    const { old, fresh } = await oldLeaderThenNewTab();

    expect(livelocked(), 'the tabs answered each other without end').toBe(false);
    expect(leaders()).toEqual([fresh]);
    expect(old.manager.isLeader).toBe(false);
    expect(old.manager.leaderId).toBe(fresh.manager.instanceId);
    expect(fresh.manager.instanceIdAsBigInt).toBeLessThan(old.manager.instanceIdAsBigInt);
  });

  it('open exactly one new socket between them, and the old tab closes its own once', async () => {
    const { old, fresh } = await oldLeaderThenNewTab();

    expect(fresh.socketsOpened, 'the new tab opened a socket more than once: leadership moved back and forth').toBe(1);
    expect(old.socketsOpened, 'the old tab opened another socket after the new tab arrived').toBe(1);
    expect(old.socketsClosed).toBe(1);
    expect(fresh.clientOpen).toBe(true);
    expect(old.clientOpen).toBe(false);
  });

  it('make no claim on a leader without a socket', async () => {
    const { old, fresh } = await oldLeaderThenNewTab();

    expect([...old.leaderWithoutClient, ...fresh.leaderWithoutClient]).toEqual([]);
  });

  it('see the old tab step down within one heartbeat of the new tab leading', async () => {
    const { old, fresh } = await oldLeaderThenNewTab();

    expect(fresh.promotions).toBe(1);
    const led: number = fresh.promotedAt[0];
    const stepped: number | undefined = old.demotedAt.find((t: number): boolean => t >= led);
    expect(stepped, 'the old tab never stepped down').toBeDefined();
    expect((stepped as number) - led).toBeLessThanOrEqual(INTERVAL.HEARTBEAT_MS);
    expect(old.demotedAt, 'the old tab stepped down more than once: it led again in between').toHaveLength(1);
  });

  it('carry the old tab\'s requests through the new leader, and its answer back', async () => {
    const { old, fresh } = await oldLeaderThenNewTab();
    fresh.emitter.on('channel:outbound-request', ({ requestId, senderInstanceId }: { requestId: string; senderInstanceId: string }): void => {
      fresh.channel.sendAck(senderInstanceId, requestId, { status: 'processed', data: { messengerReady: true } });
    });

    const answer: Promise<AckResult> = old.channel.sendToLeader({ GetSessions: { request_id: 'r-1' } }, 'r-1');
    await vi.advanceTimersByTimeAsync(SOCKET_OPEN_MS);

    await expect(answer).resolves.toEqual({ status: 'processed', error: undefined, data: { messengerReady: true } });
  });
});
