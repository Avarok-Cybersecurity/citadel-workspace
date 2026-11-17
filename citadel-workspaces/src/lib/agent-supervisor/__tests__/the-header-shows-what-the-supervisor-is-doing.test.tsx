/**
 * The supervisor's reports reach the chat header's existing path pill:
 * "Reconnecting…" while it heals a link (even though the link is down),
 * "Relayed" when it settles for a relay, and nothing extra once healed. Path
 * changes keep moving "Relayed" and "Direct" as before.
 *
 * Real: the service singleton (its constructor installs the listeners), the
 * status store, both hooks, the header and the pill. Stood in: the agent's
 * LocalDB answer "nothing paused" and the cross-tab broadcast, as in the path
 * tests. The agent's notifications are FakeAgent's, on the real event.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { P2PChatHeader } from '@/components/p2p/P2PChatHeader';
import { useConnectionRoute } from '@/components/p2p/hooks/use-connection-route';
import { useSupervisorState } from '@/components/p2p/hooks/use-supervisor-state';
import '@/lib/p2p-auto-connect-service'; // its module installs the listeners this test drives
import { clearSupervisorStatus, supervisorStateFor } from '../status';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { websocketService } from '@/lib/websocket-service';
import { instanceManager } from '@/lib/multi-instance';
import { eventEmitter } from '@/lib/event-emitter';
import { LEADER_WIRE_EVENT } from '@/lib/websocket/leader-inbound-handler';
import { MessagingLayerType } from '@/types/messaging-layer';
import { CHAT_PATH_COPY } from '@/lib/ice-servers/chat-path-copy';
import { FakeAgent } from './fake-supervising-agent';

const OURS: bigint = 9801n;
const PEER: bigint = 9802n;
const OTHER_PEER: bigint = 9803n;
const agent: FakeAgent = new FakeAgent();

function Harness({ connected }: { connected: boolean }): JSX.Element {
  return (
    <P2PChatHeader
      peerName="ada" peerUsername="ada" peerPresence={{ status: MessagingLayerType.Online, lastUpdate: 0 }} peerTyping={false}
      isConnected={connected} isRegistered paused={false}
      connectionRoute={useConnectionRoute(OURS, PEER)} supervisor={useSupervisorState(OURS, PEER)}
      onSettingsClick={vi.fn()} onOpenFiles={null}
    />
  );
}

const notice = (state: string, peer: bigint | undefined = PEER, cid: bigint = OURS): unknown => ({
  SupervisorNotification: { cid, peer_cid: peer, state, request_id: null },
});
const pill = (): string | null => screen.queryByTestId('chat-connection-path')?.textContent ?? null;
const hear = (message: unknown): void => { act((): void => { agent.wire(message); }); };

afterEach((): void => { vi.restoreAllMocks(); clearSupervisorStatus(); });

async function setup(connected: boolean): Promise<void> {
  // Only a supervising agent reports, so the listener is installed when the agent says it supervises.
  await agent.greet('supervising');
  await vi.dynamicImportSettled();
  vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((): void => {});
  vi.spyOn(websocketService, 'sendLocalDBGet').mockRejectedValue(new Error('Key not found: p2p_paused_peer'));
  if (connected) hear({ PeerConnectSuccess: { cid: OURS, peer_cid: PEER, path: 'direct', upgrading: false, request_id: null } });
  render(<Harness connected={connected} />);
}

describe('a link being healed', () => {
  it('reads "Reconnecting…" while the link is down, and nothing once it is healed', async (): Promise<void> => {
    await setup(false);
    expect(pill()).toBeNull();
    hear(notice('Healing'));
    expect(pill()).toBe('Reconnecting…');
    expect(pill()).toBe(CHAT_PATH_COPY.reconnecting);
    hear(notice('Healed'));
    expect(pill()).toBeNull();
  });

  it('reads "Reconnecting…" over a path that is now stale, then the real path again', async (): Promise<void> => {
    await setup(true);
    expect(pill()).toBe('Direct');
    hear(notice('Healing'));
    expect(pill()).toBe('Reconnecting…');
    hear(notice('Healed'));
    expect(pill()).toBe('Direct');
  });

  it('is the account\'s when the supervisor names no peer, until it heals', async (): Promise<void> => {
    await setup(false);
    hear(notice('Healing', undefined));
    expect(pill()).toBe('Reconnecting…');
    hear(notice('Healed', undefined));
    expect(pill()).toBeNull();
  });

  it('is not shown for another peer, or for another session', async (): Promise<void> => {
    await setup(false);
    hear(notice('Healing', OTHER_PEER));
    hear(notice('Healing', PEER, OURS + 100n));
    expect(pill()).toBeNull();
  });

  it('is recorded by the leader for a session another tab holds, and only by the leader', async (): Promise<void> => {
    const FOLLOWED: bigint = OURS + 500n;
    await agent.greet('supervising');
    await vi.dynamicImportSettled();
    const leader: ReturnType<typeof vi.spyOn> = vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(false);
    act((): void => { eventEmitter.emit(LEADER_WIRE_EVENT, notice('Degraded', PEER, FOLLOWED)); });
    expect(supervisorStateFor(FOLLOWED, PEER)).toBeNull();
    leader.mockReturnValue(true);
    act((): void => { eventEmitter.emit(LEADER_WIRE_EVENT, notice('Degraded', PEER, FOLLOWED)); });
    expect(supervisorStateFor(FOLLOWED, PEER)).toBe('degraded');
  });
});

describe('a link that could not be made direct', () => {
  it('reads "Relayed" with its reason', async (): Promise<void> => {
    await setup(true);
    hear(notice('Degraded'));
    expect(pill()).toBe('Relayed');
    expect(screen.getByRole('button', { name: new RegExp(CHAT_PATH_COPY.degraded) })).toBeTruthy();
  });
});

describe('what is not a supervisor report', () => {
  it('changes nothing: a malformed or unknown one', async (): Promise<void> => {
    await setup(false);
    hear(notice('Exploding'));
    hear({ SupervisorNotification: { cid: String(OURS), peer_cid: PEER, state: 'Healing' } });
    hear({ SupervisorNotification: { cid: OURS, peer_cid: 'x', state: 'Healing' } });
    expect(pill()).toBeNull();
  });
});
