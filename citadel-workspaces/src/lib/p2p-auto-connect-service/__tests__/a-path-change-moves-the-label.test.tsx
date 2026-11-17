/**
 * A connection delivered over the relay is shown as "Relayed", and turns
 * "Direct" when the agent reports the upgrade — without anyone reconnecting.
 *
 * PeerConnectSuccess used to be read as the connection's final path. It is now
 * the path at delivery (normally the server relay, `upgrading: true`), and each
 * PeerPathChangedNotification replaces it. The service singleton (whose
 * constructor installs the listeners), the store, the hook and the header are
 * the production ones; the stand-ins are the leader flag and the agent's LocalDB
 * answer "nothing paused", which the connect handler reads before it broadcasts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { P2PChatHeader } from '@/components/p2p/P2PChatHeader';
import { useConnectionRoute } from '@/components/p2p/hooks/use-connection-route';
import { eventEmitter } from '@/lib/event-emitter';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { connectionRouteFor } from '@/lib/p2p-auto-connect-service/connection-path';
import { LEADER_WIRE_EVENT } from '@/lib/websocket/leader-inbound-handler';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { instanceManager } from '@/lib/multi-instance';
import { websocketService } from '@/lib/websocket-service';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPathReport } from '@/types/ice-servers';

const OURS: bigint = 9501n;
const PEER: bigint = 9502n;

function Harness(): JSX.Element {
  const route: PeerPathReport | null = useConnectionRoute(OURS, PEER);
  return (
    <P2PChatHeader
      peerName="ada" peerUsername="ada" peerPresence={{ status: MessagingLayerType.Online, lastUpdate: 0 }} peerTyping={false}
      isConnected isRegistered paused={false} connectionRoute={route} supervisor={null} onSettingsClick={vi.fn()} onOpenFiles={null}
    />
  );
}

const changed = (cid: bigint, peerCid: bigint, path: string, upgrading: boolean): unknown => ({
  PeerPathChangedNotification: { cid, peer_cid: peerCid, path, upgrading, request_id: null },
});

function connect(cid: bigint, peerCid: bigint): void {
  eventEmitter.emit('websocket-message', { PeerConnectSuccess: { cid, peer_cid: peerCid, path: 'server_relay', upgrading: true, request_id: null } });
}

afterEach((): void => { vi.restoreAllMocks(); });

describe('a path change', () => {
  it('moves the header from "Relayed" to "Direct" on the live connection', async (): Promise<void> => {
    vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((): void => {});
    vi.spyOn(websocketService, 'sendLocalDBGet').mockRejectedValue(new Error('Key not found: p2p_paused_peer_9502'));
    connect(OURS, PEER);
    render(<Harness />);
    expect(screen.getByTestId('chat-connection-path').textContent).toBe('Relayed');

    act((): void => { eventEmitter.emit('websocket-message', changed(OURS, PEER, 'direct', false)); });
    expect(screen.getByTestId('chat-connection-path').textContent).toBe('Direct');
    expect(connectionRouteFor(PEER, OURS)).toEqual({ path: 'direct', upgrading: false });

    act((): void => { eventEmitter.emit('websocket-message', changed(OURS, PEER, 'server_relay', false)); });
    expect(screen.getByTestId('chat-connection-path').textContent).toBe('Relayed');
  });

  it('does not make a pair that is not connected read as connected', () => {
    const LONE: bigint = 9601n;
    eventEmitter.emit('websocket-message', changed(LONE, PEER, 'direct', false));
    expect(connectionRouteFor(LONE, PEER)).toBeNull();
    expect(p2pAutoConnectService.isPeerConnectedForSession(LONE, PEER)).toBe(false);
  });

  it('is recorded by the leader for a session another tab holds, and only by the leader', () => {
    // The leader answers a late follower from its own record (follower-snapshot),
    // so it must follow changes it routes away as well.
    const FOLLOWED: bigint = 9701n;
    const leader: ReturnType<typeof vi.spyOn> = vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(false);
    p2pAutoConnectService.setPeerConnected(FOLLOWED, PEER);
    eventEmitter.emit(LEADER_WIRE_EVENT, changed(FOLLOWED, PEER, 'turn', false));
    expect(connectionRouteFor(FOLLOWED, PEER)).toBeNull();

    leader.mockReturnValue(true);
    vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((): void => {});
    eventEmitter.emit(LEADER_WIRE_EVENT, changed(FOLLOWED, PEER, 'turn', false));
    expect(connectionRouteFor(FOLLOWED, PEER)).toEqual({ path: 'turn', upgrading: false });
  });
});
