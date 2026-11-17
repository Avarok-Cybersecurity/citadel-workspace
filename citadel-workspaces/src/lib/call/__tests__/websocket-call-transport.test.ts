/**
 * The property under test is SERIALISATION: a group call fans one signal out
 * to every invitee in the same tick, and two sends interleaving through the
 * messenger's async path lose one of them — the caller logs both sends, one
 * peer never rings. The transport therefore chains signal sends; these pin
 * that the chain holds, and that a failed send does not poison the sends
 * queued behind it.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';

const sendP2PCommand: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
vi.mock('@/lib/p2p/message-send-operations', () => ({ sendP2PCommand }));

import { WebSocketCallTransport } from '../websocket-call-transport';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';

const signal: { kind: "CallHeartbeat"; call_id: string; } = { kind: 'CallHeartbeat' as const, call_id: 'c1' };

function transport(): WebSocketCallTransport {
  return new WebSocketCallTransport({
    selfCid: 1n,
    senderConfig: { getCurrentCid: async () => 1n } as MessageSenderConfig,
  });
}

beforeEach(() => {
  sendP2PCommand.mockReset();
});

describe('WebSocketCallTransport.sendSignal', () => {
  it('sends signals one at a time even when dispatched together', async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;
    sendP2PCommand.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    const t: WebSocketCallTransport = transport();

    await Promise.all([t.sendSignal(2n, signal), t.sendSignal(3n, signal)]);

    expect(sendP2PCommand).toHaveBeenCalledTimes(2);
    expect(maxInFlight, 'the second send must wait for the first').toBe(1);
  });

  it('keeps sending after one send fails', async () => {
    sendP2PCommand
      .mockRejectedValueOnce(new Error('peer refused'))
      .mockResolvedValueOnce(undefined);
    const t: WebSocketCallTransport = transport();

    const first: Promise<void> = t.sendSignal(2n, signal);
    const second: Promise<void> = t.sendSignal(3n, signal);

    await expect(first).rejects.toThrow('peer refused');
    // The failure belongs to the first send alone; the chain carries on.
    await expect(second).resolves.toBeUndefined();
    expect(sendP2PCommand).toHaveBeenCalledTimes(2);
  });
});

describe('WebSocketCallTransport signal queue bound', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the next signal go when one send never settles', async () => {
    // Serialising is right until a send hangs. Nothing in the path below has a
    // timeout, so an unbounded queue would hold the hang-up behind a stalled
    // invite forever — the very outcome the ordering protects against.
    let releaseFirst: (() => void) | undefined;
    sendP2PCommand
      .mockImplementationOnce(() => new Promise<void>((resolve) => { releaseFirst = resolve; }))
      .mockImplementationOnce(() => Promise.resolve());

    const t: WebSocketCallTransport = transport();
    const stalled: Promise<void> = t.sendSignal(2n, signal);
    const behind: Promise<void> = t.sendSignal(3n, signal);

    // Before the bound elapses the second send is still queued.
    await vi.advanceTimersByTimeAsync(0);
    expect(sendP2PCommand).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendP2PCommand).toHaveBeenCalledTimes(2);

    // The stalled caller still owns its own promise; it is not resolved for it.
    releaseFirst?.();
    await expect(stalled).resolves.toBeUndefined();
    await expect(behind).resolves.toBeUndefined();
  });
});
