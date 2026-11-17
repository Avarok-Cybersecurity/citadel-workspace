/**
 * A closing follower's call goodbye reaches the leader before its session release,
 * and the leader holds the release until that goodbye has been sent.
 *
 * Closing a follower tab mid-call left the peer in the call: the channel's own
 * pagehide handler (registered at module load) posted session-release before the
 * call hook's pagehide posted call-departed, so the leader released the session and
 * the agent refused the CallEnd sent as it. Departure steps run inside the channel's
 * handler, ahead of the release; the leader's release waits on the goodbye's hold,
 * bounded so a goodbye that never completes cannot keep a closed tab's session.
 * The page is a plain EventTarget and the channel a recorder; the instance manager
 * and the hold registry are the real ones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupPageDepartureHandlers, type PageEvents, type UnloadChannel } from '../channel-lifecycle';
import { instanceManager } from '../instance-manager';
import { addDepartureStep } from '../departure-steps';
import { CALL_DEPARTED } from '@/lib/call/call-departure';
import { eventEmitter } from '@/lib/event-emitter';
import { setupSessionReleaseHandler } from '@/lib/websocket/leader-socket-teardown';
import { holdRelease, releaseAfterHolds, RELEASE_HOLD_MAX_MS } from '../release-holds';

function recorder(calls: string[]): UnloadChannel {
  return {
    send: (message: { type: string }): void => { calls.push(`send:${message.type}`); },
    announceGoodbye: (): void => { calls.push('goodbye'); },
    relinquishLeadership: (): void => { calls.push('relinquish'); },
    announcePresence: (): void => { calls.push('announce'); },
    broadcastCid: (): void => { calls.push('cid'); },
  };
}

function hidden(): Event {
  const event: Event = new Event('pagehide');
  Object.defineProperty(event, 'persisted', { value: false });
  return event;
}

const wait = (ms: number): Promise<void> => new Promise<void>((done) => { setTimeout(done, ms); });

describe('a follower closing mid-call', () => {
  const calls: string[] = [];
  let removeStep: () => void = (): void => undefined;

  beforeEach(() => {
    calls.length = 0;
    const page: EventTarget = new EventTarget();
    const channel: UnloadChannel = recorder(calls);
    setupPageDepartureHandlers(channel, page as unknown as PageEvents);
    removeStep = addDepartureStep((): void => { channel.send({ type: CALL_DEPARTED, targetInstanceId: 'leader' }); });
    instanceManager.setCid(91n);
    instanceManager.setLeader(false, 'someone-else');
    page.dispatchEvent(hidden());
  });

  afterEach(() => { removeStep(); });

  it('hands over its call before it asks for its session to be released', () => {
    expect(calls).toEqual(['send:call-departed', 'send:session-release', 'goodbye']);
  });
});

describe('the leader releasing a departed session', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('releases at once when nothing is held', () => {
    const released: bigint[] = [];
    releaseAfterHolds(5n, (): void => { released.push(5n); }, wait);
    expect(released).toEqual([5n]);
  });

  it('waits for the goodbye to be sent', async () => {
    const released: string[] = [];
    let finish: () => void = (): void => undefined;
    holdRelease(6n, new Promise<void>((done) => { finish = done; }));
    releaseAfterHolds(6n, (): void => { released.push('release'); }, wait);
    await vi.advanceTimersByTimeAsync(10);
    expect(released).toEqual([]);
    released.push('goodbye sent');
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toEqual(['goodbye sent', 'release']);
  });

  it('still releases when the goodbye fails', async () => {
    const released: bigint[] = [];
    holdRelease(7n, Promise.reject(new Error('peer gone')));
    releaseAfterHolds(7n, (): void => { released.push(7n); }, wait);
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toEqual([7n]);
  });

  it('does not let a goodbye that never finishes hold the session', async () => {
    const released: bigint[] = [];
    holdRelease(8n, new Promise<void>(() => undefined));
    releaseAfterHolds(8n, (): void => { released.push(8n); }, wait);
    await vi.advanceTimersByTimeAsync(RELEASE_HOLD_MAX_MS - 1);
    expect(released).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toEqual([8n]);
  });

  it('holds only the session the goodbye was for', () => {
    const released: bigint[] = [];
    holdRelease(9n, new Promise<void>(() => undefined));
    releaseAfterHolds(10n, (): void => { released.push(10n); }, wait);
    expect(released).toEqual([10n]);
  });
});

describe('the leader socket acting on a release request', () => {
  it('releases a held session only once its goodbye is sent', async () => {
    const released: bigint[] = [];
    setupSessionReleaseHandler({ releaseSession: (cid: bigint): void => { released.push(cid); } });
    let finish: () => void = (): void => undefined;
    holdRelease(12n, new Promise<void>((done) => { finish = done; }));
    eventEmitter.emit('session:release-request', { cid: 12n });
    await Promise.resolve();
    expect(released).toEqual([]);
    finish();
    await vi.waitFor(() => { expect(released).toEqual([12n]); });
  });
});
