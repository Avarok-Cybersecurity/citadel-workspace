/**
 * A Live Doc's background sync failing is not "Message not sent".
 *
 * Found live (2026-09-29): opening a Live Doc with an offline contact raised
 * "Message not sent — The connection to this contact is not open yet" though
 * nothing had been typed. The document's Yjs sync bytes went out, the agent
 * answered MessageSendFailure (no channel), and every failure was reported as a
 * message the person had sent. The document shows its own sync state.
 *
 * Real: the dispatch that builds the request, the failure reader and its
 * throttle, and the event bus. Stood in: the socket (`sendMessage` records).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sendP2PMessage, sendP2PMessageBytes } from '@/lib/websocket/p2p-message-dispatch';
import type { P2PConfig } from '@/lib/websocket/p2p-operations';
import { consumeSendFailure, resetSendFailureThrottle } from '../send-failure';
import { eventEmitter } from '@/lib/event-emitter';

let sent: Array<{ Message: { request_id: string } }> = [];
const config: P2PConfig = {
  init: async (): Promise<void> => undefined,
  sendMessage: async (m: unknown): Promise<void> => { sent.push(m as { Message: { request_id: string } }); },
  isLeader: (): boolean => true,
  turnFor: (() => null) as unknown as P2PConfig['turnFor'],
  securityFor: async () => 'Standard',
};

function noChannelFailureFor(requestId: string): unknown {
  return { MessageSendFailure: { cid: 7n, message: 'Peer connection for 42 not found', request_id: requestId } };
}

function toastsDuring(act: () => void): number {
  let count: number = 0;
  const off: () => void = eventEmitter.on('p2p:send-failed', (): void => { count += 1; });
  act();
  off();
  return count;
}

beforeEach((): void => { sent = []; resetSendFailureThrottle(); });

describe('a send failure', () => {
  it('for a background send is consumed without a toast', async () => {
    await sendP2PMessageBytes(config, 7n, 42n, new Uint8Array([1, 2]), 'background');
    const failure: unknown = noChannelFailureFor(sent[0].Message.request_id);
    let consumed: boolean = false;
    expect(toastsDuring((): void => { consumed = consumeSendFailure(failure); })).toBe(0);
    expect(consumed).toBe(true);
  });

  it('for something the person sent is still reported', async () => {
    await sendP2PMessage(config, 7n, 42n, 'hello');
    expect(toastsDuring((): void => { consumeSendFailure(noChannelFailureFor(sent[0].Message.request_id)); })).toBe(1);
  });

  it('for bytes the person sent is still reported', async () => {
    await sendP2PMessageBytes(config, 7n, 42n, new Uint8Array([3]), 'user');
    expect(toastsDuring((): void => { consumeSendFailure(noChannelFailureFor(sent[0].Message.request_id)); })).toBe(1);
  });
});
