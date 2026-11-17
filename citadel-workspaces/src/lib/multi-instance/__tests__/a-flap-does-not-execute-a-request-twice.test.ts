/**
 * A leadership flap must not execute the same outbound request twice.
 *
 * A backgrounded leader's heartbeat timer is throttled to roughly once a
 * minute against the five-second dead-leader timeout, so a foreground follower
 * claims leadership (`tryBecomeLeader`) while the sticky leader keeps it
 * (`handleLeaderElection` rule 1) until its rejection heartbeat lands. For
 * that window BOTH tabs hold `isLeader`, and `outbound-queue`'s leader-change
 * replay fires at exactly that moment — re-delivering entries the sticky
 * leader is still executing, un-acked only because the proxy handlers ack
 * after the work completes. The handler's `inFlight` set is per-tab, so the
 * transient leader re-executed workspace writes and Connects.
 *
 * These tests stage that window artificially: the sticky leader's side is
 * represented by its `request-executed` claim arriving on the channel, and the
 * transient leader's side by this tab activating and receiving the replay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const channelSend: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../instance-channel', () => ({
  instanceChannel: {
    sendAck: (...args: unknown[]): unknown => channelSend('ack', ...args),
    send: (...args: unknown[]): unknown => channelSend('send', ...args),
    instanceId: 'me',
  },
}));

const { leaderOutboundHandler } = await import('../leader-outbound-handler');
const { dispatchChannelMessage } = await import('../channel-message-dispatch');
const { clearExecutionClaims } = await import('../executed-requests');
const { eventEmitter } = await import('@/lib/event-emitter');
const { TIMEOUT } = await import('@/lib/timeout-constants');
type ChannelMessage = import('../channel-types').ChannelMessage;

/** Leadership is announced, not called — the handler listens for the event. */
function becomeLeaderTab(): void {
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'me' });
}

/** The sticky leader's execution claim, as the channel delivers it. */
function stickyLeaderClaims(requestId: string): void {
  const message: ChannelMessage = {
    type: 'request-executed',
    targetInstanceId: '*',
    senderInstanceId: 'sticky-leader',
    timestamp: Date.now(),
    requestId,
  };
  // The 'request-executed' arm touches neither the election state nor the CID
  // broadcast; the stubs exist only to satisfy the signature.
  dispatchChannelMessage(
    message,
    { lastLeaderHeartbeat: 0, leaderCheckInterval: null, heartbeatInterval: null, initTime: Date.now(), challenge: null, send: (): void => {} },
    (): void => {},
  );
}

const request: (requestId: string) => { requestId: string; senderInstanceId: string; payload: Record<string, unknown> } = (
  requestId: string,
): { requestId: string; senderInstanceId: string; payload: Record<string, unknown> } => ({
  requestId,
  senderInstanceId: 'follower-1',
  payload: { GetWorkspace: { request_id: requestId } } as Record<string, unknown>,
});

describe('a leadership flap', () => {
  beforeEach(() => {
    channelSend.mockReset();
    clearExecutionClaims();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-execute a request the sticky leader already began', async () => {
    // The sticky leader received the request and started the work; its claim
    // reached this tab well before the flap (claims are event-driven, and the
    // flap requires 5s of heartbeat silence).
    stickyLeaderClaims('r-flap');

    // The flap: this tab activates, and the queue's leader-change replay
    // re-delivers the entry the sticky leader is still executing.
    becomeLeaderTab();
    const sent: unknown[] = [];
    leaderOutboundHandler.setWebSocketSendFunction(async (payload: unknown) => {
      sent.push(payload);
    });

    await leaderOutboundHandler.handleOutboundRequest(request('r-flap'));

    expect(sent, 'the transient leader must not run the work a second time').toHaveLength(0);
    // Silently: the sticky leader acks when its execution completes, and an
    // error-ack here would remove the entry and report a false failure.
    const acks: unknown[][] = channelSend.mock.calls.filter((call): boolean => call[0] === 'ack');
    expect(acks, 'and must not ack over the executing leader').toEqual([]);
  });

  it('still executes a genuinely new request', async () => {
    // Without this, "execute nothing" would pass the test above.
    becomeLeaderTab();
    const sent: unknown[] = [];
    leaderOutboundHandler.setWebSocketSendFunction(async (payload: unknown) => {
      sent.push(payload);
    });

    await leaderOutboundHandler.handleOutboundRequest(request('r-fresh'));

    expect(sent, 'a request no other leader has claimed must run').toHaveLength(1);
    const errorAcks: unknown[][] = channelSend.mock.calls.filter((call): boolean => JSON.stringify(call).includes('error'));
    expect(errorAcks).toEqual([]);
  });

  it('broadcasts its own execution claim before the work starts', async () => {
    // The other half of the mechanism: what this tab executes, a transient
    // leader elsewhere must be able to refuse.
    becomeLeaderTab();
    let claimedBeforeSend: boolean = false;
    leaderOutboundHandler.setWebSocketSendFunction(async () => {
      claimedBeforeSend = channelSend.mock.calls.some(
        (call): boolean => call[0] === 'send' && (call[1] as { type?: string })?.type === 'request-executed',
      );
    });

    await leaderOutboundHandler.handleOutboundRequest(request('r-claim'));

    expect(claimedBeforeSend, 'the claim must precede the work, or the in-flight window stays open').toBe(true);
  });

  it('forgets a claim once the id can no longer be replayed', async () => {
    // The registry is bounded by TIMEOUT.OUTBOUND_ACK_MS: past that, the
    // requester's outer deadline has force-acknowledged the id out of the
    // queue, so refusing it protects nothing — and would block the legitimate
    // recovery retry when a leader genuinely dies mid-execution.
    vi.useFakeTimers();
    stickyLeaderClaims('r-stale');
    vi.setSystemTime(Date.now() + TIMEOUT.OUTBOUND_ACK_MS + 1);

    becomeLeaderTab();
    const sent: unknown[] = [];
    leaderOutboundHandler.setWebSocketSendFunction(async (payload: unknown) => {
      sent.push(payload);
    });

    await leaderOutboundHandler.handleOutboundRequest(request('r-stale'));

    expect(sent, 'an expired claim must not block execution').toHaveLength(1);
  });
});
