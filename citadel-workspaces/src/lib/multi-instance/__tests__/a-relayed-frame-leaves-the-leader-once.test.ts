/**
 * The leader's half of a follower's call: a frame relayed over the instance
 * channel goes out on the leader's socket once, for the session it names.
 *
 * The other half (a follower hands each frame over) is pinned in
 * call/__tests__/a-follower-tab-carries-a-call.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  deliverRelayedFrame,
  installMediaFrameRelay,
  readRelayedFrame,
  MEDIA_FRAME_OUT,
  type MediaFrameSink,
} from '../media-frame-relay';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

const payload: Record<string, unknown> = {
  cid: 11n, peerCid: 22n, track: 1, kind: 2, timestamp: 33, flags: 1, payload: new Uint8Array([9, 8, 7]),
};

function sink(): MediaFrameSink & { sendMediaFrame: ReturnType<typeof vi.fn> } {
  return { sendMediaFrame: vi.fn() };
}

describe('a relayed frame', () => {
  it('leaves the leader once, from the follower\'s session', () => {
    const s: ReturnType<typeof sink> = sink();
    deliverRelayedFrame(payload, true, s);
    expect(s.sendMediaFrame).toHaveBeenCalledTimes(1);
    expect(s.sendMediaFrame).toHaveBeenCalledWith(11n, 22n, 1, 2, 33, 1, new Uint8Array([9, 8, 7]));
  });

  it('is not sent by a tab that does not lead', () => {
    // A demoted leader still hearing 'leader' traffic mid-election would
    // otherwise send it a second time from a socket it is giving up.
    const s: ReturnType<typeof sink> = sink();
    deliverRelayedFrame(payload, false, s);
    expect(s.sendMediaFrame).not.toHaveBeenCalled();
  });

  it('is refused when malformed rather than sent as somebody', () => {
    expect(readRelayedFrame({ ...payload, cid: '11' })).toBeNull();
    expect(readRelayedFrame({ ...payload, payload: [9, 8, 7] })).toBeNull();
    expect(readRelayedFrame({ ...payload, track: -1 })).toBeNull();
    expect(readRelayedFrame(null)).toBeNull();
  });
});

describe('the instance channel', () => {
  it('carries a follower\'s frame to the leader\'s socket', async () => {
    const { dispatchChannelMessage } = await import('../channel-message-dispatch');
    const { eventEmitter } = await import('../../event-emitter');
    const s: ReturnType<typeof sink> = sink();
    installMediaFrameRelay({
      on: (event: string, handler: (p: unknown) => void): void => { eventEmitter.on(event, handler); },
      isLeader: (): boolean => true,
      sink: (): MediaFrameSink => s,
    });

    const message: ChannelMessage = {
      type: MEDIA_FRAME_OUT, targetInstanceId: 'leader', senderInstanceId: 'follower', timestamp: 0, payload,
    };
    dispatchChannelMessage(message, {} as LeaderElectionState, () => {});

    expect(s.sendMediaFrame).toHaveBeenCalledTimes(1);
  });
});
