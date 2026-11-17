/**
 * A call placed from a tab that does not hold the WebSocket.
 *
 * One browser has one socket, owned by the leader tab; every other tab proxies
 * through it. The call transport reached for the leader's raw client instead,
 * so in a follower `MediaOpen` threw "Not connected", `MediaClose` did nothing
 * and every outgoing frame was dropped -- which is why calling was switched off
 * in followers altogether.
 *
 * The media itself stays in the tab whose session is in the call: a
 * MediaStream cannot cross tabs, and capturing in two would duplicate it. What
 * crosses is what the leader needs to put on the wire -- the session requests,
 * and each encoded frame, exactly once.
 *
 * The two mocks are the I/O boundary this transport is translation over: the
 * service (leader socket or proxy) and the instance channel (a BroadcastChannel).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tab: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
const channelSend: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
const sendMediaFrame: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());
const sendRequest: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());

vi.mock('@/lib/multi-instance', () => ({
  instanceManager: { get isLeader(): boolean { return tab.isLeader; } },
  instanceChannel: { send: channelSend },
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    // The follower's truth: no client of its own, ever.
    getClient: (): { sendMediaFrame: typeof sendMediaFrame } | null => (tab.isLeader ? { sendMediaFrame } : null),
    getWasmClient: async (): Promise<null> => null,
    sendRequest,
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { WebSocketCallTransport } from '../websocket-call-transport';
import { MEDIA_FRAME_OUT } from '@/lib/multi-instance/media-frame-relay';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';
import type { WireFrame } from '../frame-codec';

const frame: WireFrame = { track: 1, kind: 2, timestamp: 33, flags: 1, payload: new Uint8Array([9, 8, 7]) };

function transport(): WebSocketCallTransport {
  return new WebSocketCallTransport({
    selfCid: 11n,
    senderConfig: { getCurrentCid: async () => 11n } as MessageSenderConfig,
  });
}

function sentRequest(index: number): Record<string, { request_id: string; cid: bigint; peer_cid: bigint }> {
  return sendRequest.mock.calls[index][0] as Record<string, { request_id: string; cid: bigint; peer_cid: bigint }>;
}

beforeEach(() => {
  tab.isLeader = false;
  channelSend.mockReset();
  sendMediaFrame.mockReset();
  sendRequest.mockReset();
  sendRequest.mockResolvedValue(undefined);
});

describe('a follower tab in a call', () => {
  it('opens its media session through the leader and hears the answer', async () => {
    const opening: Promise<void> = transport().openSession(22n);
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(1));

    const open: { request_id: string; cid: bigint; peer_cid: bigint } = sentRequest(0).MediaOpen;
    expect(open).toMatchObject({ cid: 11n, peer_cid: 22n });
    // The answer is routed back to the asking tab by request_id.
    eventEmitter.emit('websocket-message', { MediaSessionOpened: { request_id: open.request_id, cid: 11n, peer_cid: 22n } });

    await expect(opening).resolves.toBeUndefined();
  });

  it('closes its media session through the leader', async () => {
    await transport().closeSession(22n);
    expect(sentRequest(0).MediaClose).toMatchObject({ cid: 11n, peer_cid: 22n });
  });

  it('hands each frame to the leader once, addressed from its own session', () => {
    transport().sendFrame(22n, frame);

    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(channelSend).toHaveBeenCalledWith({
      type: MEDIA_FRAME_OUT,
      targetInstanceId: 'leader',
      payload: { cid: 11n, peerCid: 22n, ...frame },
    });
  });
});

describe('the leader tab in a call', () => {
  it('puts its own frames on its socket and relays nothing', () => {
    tab.isLeader = true;
    transport().sendFrame(22n, frame);

    expect(sendMediaFrame).toHaveBeenCalledTimes(1);
    expect(sendMediaFrame).toHaveBeenCalledWith(11n, 22n, 1, 2, 33, 1, frame.payload);
    expect(channelSend).not.toHaveBeenCalled();
  });
});
