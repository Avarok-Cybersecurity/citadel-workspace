/**
 * The tab a call lives in, closing mid-call: the peer is told.
 *
 * Its own CallEnd would go out through the leader on an async path a closing
 * document does not live to finish, so the peer sat in a dead call until the
 * heartbeat timeout. A follower hands the call to the leader on pagehide (a
 * synchronous post), and the leader ends it for that session.
 *
 * Mocked: the call transport, the I/O boundary the leader sends through.
 */
import { describe, it, expect, vi } from 'vitest';
import { departureOf, endForDepartedTab, type DepartureDeps } from '../call-departure';
import type { CallTransport } from '../call-transport';
import type { CallState } from '../call-state';

const active: CallState = {
  callId: 'c1', status: 'active',
  participants: new Map([[7n, {}], [8n, {}]]),
} as unknown as CallState;

function leader(isLeader: boolean): { deps: DepartureDeps; transport: { sendSignal: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn> }; as: bigint[] } {
  const transport: { sendSignal: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn> } = {
    sendSignal: vi.fn().mockResolvedValue(undefined), closeSession: vi.fn().mockResolvedValue(undefined),
  };
  const as: bigint[] = [];
  return {
    transport, as,
    deps: {
      isLeader: (): boolean => isLeader,
      transportFor: (cid: bigint): CallTransport => { as.push(cid); return transport as unknown as CallTransport; },
      reportFailure: vi.fn(),
    },
  };
}

describe('a call tab closing', () => {
  it('hands over the session, the call and everyone in it', () => {
    expect(departureOf(active, 11n)).toEqual({ cid: 11n, callId: 'c1', peers: [7n, 8n] });
    expect(departureOf({ ...active, status: 'ended' }, 11n)).toBeNull();
  });

  it('is ended by the leader for that session, with every peer told', async () => {
    const l: ReturnType<typeof leader> = leader(true);
    await endForDepartedTab(departureOf(active, 11n), l.deps);
    expect(l.as).toEqual([11n]);
    expect(l.transport.sendSignal).toHaveBeenCalledWith(7n, { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });
    expect(l.transport.sendSignal).toHaveBeenCalledWith(8n, { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });
    expect(l.transport.closeSession).toHaveBeenCalledTimes(2);
  });

  it('is not ended twice by a tab that does not lead', async () => {
    const l: ReturnType<typeof leader> = leader(false);
    await endForDepartedTab(departureOf(active, 11n), l.deps);
    expect(l.transport.sendSignal).not.toHaveBeenCalled();
  });

  it('refuses a malformed hand-over rather than ending some other call', async () => {
    const l: ReturnType<typeof leader> = leader(true);
    await endForDepartedTab({ cid: '11', callId: 'c1', peers: [7n] }, l.deps);
    await endForDepartedTab({ cid: 11n, callId: 'c1', peers: ['7'] }, l.deps);
    expect(l.transport.sendSignal).not.toHaveBeenCalled();
  });
});
