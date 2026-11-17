/**
 * A server-initiated disconnect must actually disconnect the client.
 *
 * `DisconnectNotification` is what the internal service pushes when a session
 * dies server-side. The handler used to log it and invalidate a cache, leaving
 * `currentConnectionInfo` populated and `isConnected` true — so the workspace
 * stayed fully rendered, every action hung or timed out, and nothing told the
 * user. The user-initiated path in lifecycle.ts had the teardown all along.
 *
 * The CID check is the other half: the internal service multiplexes several
 * accounts over one socket, so tearing down on any CID would take a different
 * account's UI down with it.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleWebSocketMessage } from '../message-handling';
import type { ConnectionState } from '../state';
import type { ConnectionIO } from '../io';
import type { WebSocketMessage } from '@/types/ws-message-types';

const CURRENT: bigint = 111n;
const OTHER: bigint = 222n;

function harness(currentCid: bigint | undefined): { state: ConnectionState; io: ConnectionIO; } {
  const state: ConnectionState = {
    currentConnectionInfo: currentCid === undefined ? null : { cid: currentCid },
    setCurrentConnectionInfo: vi.fn(),
    invalidateCache: vi.fn(),
    pendingRequests: new Map(),
  } as unknown as ConnectionState;
  const io: ConnectionIO = {
    updateConnectionService: vi.fn(),
    broadcastConnectionStatus: vi.fn(),
  } as unknown as ConnectionIO;
  return { state, io };
}

function notify(cid: bigint): WebSocketMessage {
  return { DisconnectNotification: { cid } } as unknown as WebSocketMessage;
}

describe('a server-initiated disconnect tears the session down', () => {
  it('clears the connection when the notification names the current session', async () => {
    const h: { state: ConnectionState; io: ConnectionIO; } = harness(CURRENT);

    await handleWebSocketMessage(notify(CURRENT), h.state, h.io, vi.fn(), vi.fn());

    expect(h.state.setCurrentConnectionInfo).toHaveBeenCalledWith(null);
    expect(h.io.updateConnectionService).toHaveBeenCalledWith({ cid: null, isConnected: false });
    expect(h.io.broadcastConnectionStatus).toHaveBeenCalledWith({ isConnected: false });
  });

  it('leaves another account alone', async () => {
    // The socket carries every account in this browser. Tearing down on any
    // CID would sign the user out of a session that is perfectly healthy.
    const h: { state: ConnectionState; io: ConnectionIO; } = harness(CURRENT);

    await handleWebSocketMessage(notify(OTHER), h.state, h.io, vi.fn(), vi.fn());

    expect(h.state.setCurrentConnectionInfo).not.toHaveBeenCalled();
    expect(h.io.updateConnectionService).not.toHaveBeenCalled();
    // The cache is still invalidated either way — that part was never wrong.
    expect(h.state.invalidateCache).toHaveBeenCalled();
  });

  it('does nothing when there is no current session to lose', async () => {
    const h: { state: ConnectionState; io: ConnectionIO; } = harness(undefined);

    await handleWebSocketMessage(notify(CURRENT), h.state, h.io, vi.fn(), vi.fn());

    expect(h.state.setCurrentConnectionInfo).not.toHaveBeenCalled();
  });
});
