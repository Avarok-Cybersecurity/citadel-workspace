/**
 * A media open the service refuses leaves the service's sentence in the console.
 *
 * In a group call a refused leg becomes that peer dropping out, and the reason
 * reached nobody: parent run 39177756618 watched A and C fail to open a session
 * four times each, and the only trace was the bare word MediaSessionFailed.
 *
 * Mocked: the WebSocket service singleton, which is the socket itself. The
 * request/response plumbing and the event emitter run as in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';

interface MediaOpenRequest { MediaOpen: { request_id: string } }

const answer: { reply: (requestId: string) => Record<string, unknown> } = vi.hoisted((): { reply: (requestId: string) => Record<string, unknown> } => ({
  reply: (): Record<string, unknown> => ({}),
}));

// sendRequest is the service's own send: the leader's socket or, in a
// follower, the proxy through it. Either way the answer comes back as an event.
vi.mock('@/lib/websocket-service', (): { websocketService: { sendRequest: (request: MediaOpenRequest) => Promise<void> } } => ({
  websocketService: {
    sendRequest: async (request: MediaOpenRequest): Promise<void> => {
      queueMicrotask((): void => eventEmitter.emit('websocket-message', answer.reply(request.MediaOpen.request_id)));
    },
  },
}));
vi.mock('@/lib/p2p/message-send-operations', (): { sendP2PCommand: ReturnType<typeof vi.fn> } => ({ sendP2PCommand: vi.fn() }));

import { WebSocketCallTransport } from '../websocket-call-transport';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';

const WITHDRAWN: string =
  'the peer connection withdrew its UDP channel offer; reconnect to the peer with UDP enabled to place a call';

function transport(): WebSocketCallTransport {
  return new WebSocketCallTransport({
    selfCid: 1n,
    senderConfig: { getCurrentCid: async (): Promise<bigint> => 1n } as MessageSenderConfig,
  });
}

let warn: MockInstance<typeof console.warn>;
beforeEach((): void => { warn = vi.spyOn(console, 'warn').mockImplementation((): undefined => undefined); });
afterEach((): void => { warn.mockRestore(); });

describe('WebSocketCallTransport.openSession', () => {
  it('logs the service reason, whole, when the open is refused', async () => {
    answer.reply = (requestId: string): Record<string, unknown> => ({
      MediaSessionFailed: { cid: 1n, peer_cid: 7n, message: WITHDRAWN, request_id: requestId },
    });

    await expect(transport().openSession(7n)).rejects.toThrow(WITHDRAWN);

    expect(warn).toHaveBeenCalledWith('[Call]', 'media session with 7 was refused:', WITHDRAWN);
  });

  it('logs nothing when the session opens', async () => {
    answer.reply = (requestId: string): Record<string, unknown> => ({ MediaSessionOpened: { cid: 1n, peer_cid: 7n, request_id: requestId } });

    await expect(transport().openSession(7n)).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });
});
