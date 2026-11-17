/**
 * A call when another Citadel tab takes over the browser's connection.
 *
 * The agent binds a media session to the connection that opened it, and a new
 * leader tab opens a new connection. Once that connection has claimed the
 * session, the call's media sessions are opened again on it. When that fails,
 * the leg is gone: the call says so the way any media failure does -- a 1:1
 * call fails with the reason on screen, a group drops that participant -- and
 * the peer is told, rather than the call carrying on with a dead media leg.
 *
 * Real: the CallManager, reducer, retry policy and session lifecycle. Mocked:
 * the transport (the socket) and the clock's timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { CallManager } from '../call-manager';
import { DIRECT_CALL, type CallState } from '../call-state';
import { LOST_ON_TAKEOVER } from '../lost-on-takeover';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds, CallSignalPayload } from '@/types/p2p-commands';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };

interface Harness {
  manager: CallManager;
  openSession: ReturnType<typeof vi.fn>;
  sendSignal: ReturnType<typeof vi.fn>;
  ends: () => Array<[bigint, CallSignalPayload]>;
  settle: (work: Promise<void>) => Promise<void>;
}

function harness(): Harness {
  const openSession: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  const sendSignal: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
  const timers: Array<() => void> = [];
  const transport: CallTransport = { openSession, closeSession: vi.fn().mockResolvedValue(undefined), sendFrame: vi.fn(), sendSignal };
  const manager: CallManager = new CallManager({
    transport, selfCid: 1n, capabilities: CAPS, now: () => 0,
    schedule: (fn) => { timers.push(fn); return (): void => undefined; },
    onStateChanged: () => undefined, resolvePeerName: (cid: bigint) => `peer-${cid}`, onKeyframeRequested: () => undefined,
  });
  return {
    manager, openSession, sendSignal,
    ends: () => sendSignal.mock.calls.filter((c) => (c[1] as CallSignalPayload).kind === 'CallEnd') as Array<[bigint, CallSignalPayload]>,
    // Fires the retry pauses (and whatever else is due) until the work is done.
    settle: async (work: Promise<void>): Promise<void> => {
      let done: boolean = false;
      void work.finally((): void => { done = true; });
      for (let round: number = 0; round < 50 && !done; round += 1) {
        await new Promise<void>((r) => setTimeout(r, 0));
        for (const fn of timers.splice(0)) fn();
      }
      await work;
    },
  };
}

async function inCallWith(h: Harness, peers: bigint[]): Promise<void> {
  await h.manager.start('c1', peers.map((cid) => ({ cid, username: `peer-${cid}` })), AUDIO, peers.length > 1 ? { kind: 'group', roomId: 'g1' } : DIRECT_CALL, null);
  for (const cid of peers) {
    await h.manager.handleSignal(cid, `peer-${cid}`, { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: AUDIO });
  }
  expect(h.manager.getState()?.status).toBe('active');
  h.openSession.mockClear();
  h.sendSignal.mockClear();
}

describe('a call whose connection another tab took over', () => {
  it('opens every media session again on the new connection', async () => {
    const h: Harness = harness();
    await inCallWith(h, [2n]);
    await h.settle(h.manager.reopenMedia());
    expect(h.openSession).toHaveBeenCalledWith(2n);
    expect(h.manager.getState()?.status).toBe('active');
    expect(h.ends()).toEqual([]);
  });

  it('fails a 1:1 call that cannot get its media back, says why, and tells the peer', async () => {
    const h: Harness = harness();
    await inCallWith(h, [2n]);
    h.openSession.mockRejectedValue(new Error('Session unavailable to this connection'));
    await h.settle(h.manager.reopenMedia());

    const state: CallState | null = h.manager.getState();
    expect(state?.status).toBe('failed');
    expect(state?.reason).toBe(LOST_ON_TAKEOVER);
    expect(h.ends()).toEqual([[2n, { kind: 'CallEnd', call_id: 'c1', reason: 'error' }]]);
  });

  it('in a group, drops only the participant whose media is gone, and tells them', async () => {
    const h: Harness = harness();
    await inCallWith(h, [2n, 3n]);
    h.openSession.mockImplementation(async (cid: bigint): Promise<void> => {
      if (cid === 3n) throw new Error('refused');
    });
    await h.settle(h.manager.reopenMedia());

    const state: CallState | null = h.manager.getState();
    expect(state?.status).toBe('active');
    expect(state?.participants.get(3n)?.status).toBe('left');
    expect(state?.participants.get(2n)?.status).toBe('active');
    expect(h.ends()).toEqual([[3n, { kind: 'CallEnd', call_id: 'c1', reason: 'error' }]]);
  });
});
