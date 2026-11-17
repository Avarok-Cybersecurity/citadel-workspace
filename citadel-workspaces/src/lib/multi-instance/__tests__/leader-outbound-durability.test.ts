/**
 * A leadership flap must not fail the requests it interrupts.
 *
 * A leader whose tab is backgrounded has its heartbeat `setInterval` throttled
 * by the browser to roughly once a minute, against a five-second dead-leader
 * timeout. So a foreground follower sees silence, claims leadership, activates
 * — and is demoted again milliseconds later by the real leader's event-driven
 * reply, which is not throttled. That flap repeats about every minute in the
 * multi-tab workflow this app is built around.
 *
 * Two things used to happen on every flap: the newly-"active" handler had no
 * socket yet and error-acked everything in flight, and the queue replayed
 * requests the old leader might still be executing.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';

const sendAck: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('../instance-channel', () => ({
  instanceChannel: {
    sendAck: (...args: unknown[]): unknown => sendAck(...args),
    send: (...args: unknown[]): unknown => sendAck(...args),
    instanceId: 'me',
  },
}));

const { leaderOutboundHandler } = await import('../leader-outbound-handler');
const { eventEmitter } = await import('@/lib/event-emitter');

/** Leadership is announced, not called — the handler listens for the event. */
function becomeLeaderTab(): void {
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'me' });
}

const request: (requestId: string) => { requestId: string; senderInstanceId: string; payload: Record<string, unknown>; } = (requestId: string): { requestId: string; senderInstanceId: string; payload: Record<string, unknown>; } => ({
  requestId,
  senderInstanceId: 'follower-1',
  payload: { Message: { peer_cid: 1n } } as Record<string, unknown>,
});

describe('the leader outbound handler', () => {
  beforeEach(() => {
    sendAck.mockReset();
  });

  it('waits for a socket that is moments away, rather than failing the request', async () => {
    becomeLeaderTab();
    leaderOutboundHandler.setWebSocketSendFunction(undefined as never);

    const sent: unknown[] = [];
    // The flap shape: leadership won, socket registered a moment later.
    setTimeout(() => {
      leaderOutboundHandler.setWebSocketSendFunction(async (payload: unknown) => {
        sent.push(payload);
      });
    }, 100);

    await leaderOutboundHandler.handleOutboundRequest(request('r-1'));

    expect(sent, 'a request caught mid-flap must still be sent').toHaveLength(1);
    const errorAcks: ReturnType<typeof sendAck.mock.calls.filter> = sendAck.mock.calls.filter((call): boolean => JSON.stringify(call).includes('error'));
    expect(errorAcks, 'and must not be failed on the way').toEqual([]);
  });

  it('still fails quickly when no socket is coming at all', async () => {
    // The opposite mistake: holding indefinitely would leave a follower waiting
    // out the queue's retries instead of being told nobody is listening.
    becomeLeaderTab();
    leaderOutboundHandler.setWebSocketSendFunction(undefined as never);

    const started: number = Date.now();
    await leaderOutboundHandler.handleOutboundRequest(request('r-never'));
    const elapsed: number = Date.now() - started;

    const errorAcks: ReturnType<typeof sendAck.mock.calls.filter> = sendAck.mock.calls.filter((call): boolean => JSON.stringify(call).includes('error'));
    expect(errorAcks.length, 'a genuine absence must be reported').toBeGreaterThan(0);
    expect(elapsed, 'and reported well inside the queue retry deadline').toBeLessThan(5000);
  });

  it('runs a duplicate delivery once', async () => {
    let running: number = 0;
    let peak: number = 0;

    becomeLeaderTab();
    leaderOutboundHandler.setWebSocketSendFunction(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
    });

    // The retry shape: the same requestId delivered again while the first is
    // still awaiting. The proxy handlers ack only after the work completes, so
    // without the in-flight set this executed twice.
    await Promise.all([
      leaderOutboundHandler.handleOutboundRequest(request('r-2')),
      leaderOutboundHandler.handleOutboundRequest(request('r-2')),
    ]);

    expect(peak, 'a duplicate delivery must not start the work twice').toBe(1);
  });

  it('accepts the same id again once the first has finished', async () => {
    // The set is an in-flight guard, not a permanent ledger: a genuinely new
    // request that reuses an id after completion must still run.
    let runs: number = 0;
    becomeLeaderTab();
    leaderOutboundHandler.setWebSocketSendFunction(async () => {
      runs += 1;
    });

    await leaderOutboundHandler.handleOutboundRequest(request('r-3'));
    await leaderOutboundHandler.handleOutboundRequest(request('r-3'));

    expect(runs).toBe(2);
  });
});
