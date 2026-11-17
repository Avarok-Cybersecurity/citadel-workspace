/**
 * A claim made in one tab is heard in every tab.
 *
 * The leader claims its followers' sessions on its own connection
 * (follower-session-claims.ts), so the tab whose session it is never made the
 * claim -- and it is that tab that must tell the agent what it has in front.
 */
import { describe, it, expect } from 'vitest';
import { installClaimRelay, claimedFromChannel, SESSION_CLAIMED, type ClaimedEvent } from '../claim-relay';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

type Handler = (payload: unknown) => void;

function relay(): { emit: (e: ClaimedEvent) => void; sent: bigint[] } {
  const handlers: Handler[] = [];
  const sent: bigint[] = [];
  installClaimRelay({
    on: (event: string, handler: Handler): void => { if (event === SESSION_CLAIMED) handlers.push(handler); },
    send: (cid: bigint): void => { sent.push(cid); },
  });
  return { emit: (e: ClaimedEvent): void => { for (const h of handlers) h(e); }, sent };
}

describe('a claim', () => {
  it('made here goes to the other tabs', () => {
    const r: { emit: (e: ClaimedEvent) => void; sent: bigint[] } = relay();
    r.emit({ cid: 4n });
    expect(r.sent).toEqual([4n]);
  });

  it('heard from another tab is not sent back', () => {
    const r: { emit: (e: ClaimedEvent) => void; sent: bigint[] } = relay();
    r.emit({ cid: 4n, relayed: true });
    expect(r.sent).toEqual([]);
  });

  it('arrives from another tab as the same event, marked relayed', () => {
    expect(claimedFromChannel({ cid: 4n })).toEqual({ cid: 4n, relayed: true });
    expect(claimedFromChannel({ cid: '4' })).toBeNull();
    expect(claimedFromChannel(undefined)).toBeNull();
  });
});

describe('the instance channel', () => {
  it('puts another tab\'s claim on this tab\'s bus', async () => {
    const { dispatchChannelMessage } = await import('../channel-message-dispatch');
    const { eventEmitter } = await import('../../event-emitter');
    const seen: ClaimedEvent[] = [];
    const off: () => void = eventEmitter.on<ClaimedEvent>(SESSION_CLAIMED, (e) => { seen.push(e); });
    const message: ChannelMessage = { type: 'session-claimed', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: 0, payload: { cid: 4n } };
    dispatchChannelMessage(message, {} as LeaderElectionState, () => {});
    off();
    expect(seen).toEqual([{ cid: 4n, relayed: true }]);
  });
});
