/**
 * A push that begins while an earlier push of the same session is still sending is queued
 * behind it in the SDK (one primary stream per session), and can wait well past FILE_SEND_MS
 * with no tick of its own. It says so — "waiting for the earlier transfer to finish" — rather
 * than sitting at 0 %, and moves to progress at its first TransferTick.
 *
 * The limit, accepted for 0.15.4 and listed for 0.15.5: only this page's own RE-VFS pushes of
 * the session are counted. A chat send, or another tab's transfer, ahead of the push in the
 * SDK's queue is not seen, and such a push shows 0 % until its first tick (the last test below
 * holds that, so lifting the limit changes it on purpose).
 *
 * Real: the transport (backendSendFile), the session's push registry and the phase events.
 * Fake: the clock and the agent's frames (push-harness.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onPushPhase } from '../push-phase-events';
import { pushPhaseLabel, SessionPushes, type PushPhase } from '../push-watch';
import { dispatchAck, settled, startUpload, tick, type StartedPush } from './push-harness';

const CID: bigint = 21n;
const OTHER_SESSION: bigint = 22n;

interface Heard { readonly phases: PushPhase[]; readonly stop: () => void; }

/** Every phase `pushId` reports, in order. */
function hear(pushId: string): Heard {
  const phases: PushPhase[] = [];
  const stop: () => void = onPushPhase(pushId, (phase: PushPhase): void => { phases.push(phase); });
  return { phases, stop };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a push queued behind an earlier one of its session', () => {
  it('says it is waiting for the earlier transfer, then shows its progress', async () => {
    vi.useFakeTimers();
    const first: StartedPush = startUpload(CID, 42n, 'first');
    const second: StartedPush = startUpload(CID, 43n, 'second');
    const heard: Heard = hear('second');
    await Promise.resolve();

    dispatchAck(first.requestId());
    tick(first.requestId(), 'TransferBeginning');
    dispatchAck(second.requestId());
    tick(second.requestId(), 'TransferBeginning');
    expect(heard.phases).toEqual([{ kind: 'waiting-for-earlier' }]);

    // The earlier push takes far longer than FILE_SEND_MS; the queued one is not timed meanwhile.
    for (let group: number = 1; group <= 4; group++) {
      await vi.advanceTimersByTimeAsync(25_000);
      tick(first.requestId(), { TransferTick: [group, 4, 1.0] });
    }
    tick(first.requestId(), 'TransferComplete');
    expect(await first.pending).toMatchObject({ success: true });
    expect(await settled(second.pending)).toBe(false);

    tick(second.requestId(), { TransferTick: [1, 2, 1.0] });
    expect(heard.phases).toEqual([{ kind: 'waiting-for-earlier' }, { kind: 'progress', percentage: 50 }]);
    tick(second.requestId(), 'TransferComplete');
    expect(await second.pending).toMatchObject({ success: true });
    heard.stop();
  });

  it('is not said to wait when nothing else of its session is in flight', async () => {
    const only: StartedPush = startUpload(OTHER_SESSION, 42n, 'only');
    const heard: Heard = hear('only');
    await Promise.resolve();

    dispatchAck(only.requestId());
    tick(only.requestId(), 'TransferBeginning');
    expect(heard.phases).toEqual([{ kind: 'progress', percentage: 0 }]);
    tick(only.requestId(), 'TransferComplete');
    await only.pending;
    heard.stop();
  });
});

describe('the limit of what counts as an earlier transfer (0.15.4)', () => {
  it('does not see a chat transfer of the session that is ahead in the queue', async () => {
    const push: StartedPush = startUpload(CID, 42n, 'behind-a-chat-send');
    const heard: Heard = hear('behind-a-chat-send');
    await Promise.resolve();

    // A chat send's sender-side stream for the same session: begun and still sending.
    tick('a-chat-send', 'TransferBeginning');
    tick('a-chat-send', { TransferTick: [1, 9, 1.0] });
    dispatchAck(push.requestId());
    tick(push.requestId(), 'TransferBeginning');
    expect(heard.phases).toEqual([{ kind: 'progress', percentage: 0 }]);

    tick(push.requestId(), 'TransferComplete');
    await push.pending;
    heard.stop();
  });
});

describe('the session registry', () => {
  it('queues a push only behind another of the same session, until that one settles', () => {
    const pushes: SessionPushes = new SessionPushes();
    expect(pushes.begin(1n, 'a')).toBe(false);
    expect(pushes.begin(2n, 'b')).toBe(false);
    expect(pushes.begin(1n, 'c')).toBe(true);
    pushes.end(1n, 'a');
    pushes.end(1n, 'c');
    expect(pushes.begin(1n, 'd')).toBe(false);
  });

  it('names the waiting state in the words the toast shows', () => {
    expect(pushPhaseLabel('plan.pdf', { kind: 'waiting-for-earlier' })).toBe('plan.pdf: waiting for the earlier transfer to finish…');
    expect(pushPhaseLabel('plan.pdf', { kind: 'progress', percentage: 50 })).toBe('Uploading plan.pdf… 50%');
  });
});
