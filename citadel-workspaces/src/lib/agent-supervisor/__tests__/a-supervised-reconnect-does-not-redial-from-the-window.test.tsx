/**
 * After the agent reports its server link back, a window used to reset and
 * redial every P2P link the drop took. For a supervised account the agent
 * redials them itself, so the window does neither; an older agent still gets
 * the old resume.
 *
 * Mocked as in a-deploy-or-reconnect-is-a-banner: the tab's session record
 * (IndexedDB), the workspace reload (an agent request), and the auto-connect
 * service (recorded: its dials are agent requests). The watcher, reader,
 * handler and the capability read from the greeting are real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const resetConnectionState: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
const connectToAllRegisteredPeers: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: async (): Promise<void> => undefined }));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    resetConnectionState: (): Promise<void> => resetConnectionState(),
    connectToAllRegisteredPeers: (): Promise<void> => connectToAllRegisteredPeers(),
  },
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<unknown> => ({ selectedCid: 42n, selectedUsername: 'alice', selectedServerAddress: 'bench.work.avarok.net' }),
}));

import { ServerReconnectWatcher } from '@/components/ServerReconnectWatcher';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { registerCapabilityRoute } from '@/lib/agent-conversations/capabilities';
import { FakeAgent } from './fake-supervising-agent';

const agent: FakeAgent = new FakeAgent();
const settle: () => Promise<void> = async (): Promise<void> => { await act(async () => { for (let i: number = 0; i < 20; i += 1) await Promise.resolve(); }); };

async function reconnected(): Promise<void> {
  render(<ConfirmDialogProvider><MemoryRouter><ServerReconnectWatcher /></MemoryRouter></ConfirmDialogProvider>);
  act(() => { agent.wire({ ServerReconnected: { cid: 42n, request_id: null } }); });
  await settle();
}

beforeEach((): void => {
  vi.clearAllMocks();
  registerCapabilityRoute({ isLeader: () => true, askLeader: async () => { throw new Error('the leader does not ask itself'); } });
});

describe('the server link coming back', () => {
  it('leaves the peers to a supervising agent', async (): Promise<void> => {
    await agent.greet('supervising');
    await reconnected();
    expect(resetConnectionState).not.toHaveBeenCalled();
    expect(connectToAllRegisteredPeers).not.toHaveBeenCalled();
  });

  it('still resumes them for an agent that does not supervise', async (): Promise<void> => {
    await agent.greet('older');
    await reconnected();
    expect(resetConnectionState).toHaveBeenCalledTimes(1);
    expect(connectToAllRegisteredPeers).toHaveBeenCalledTimes(1);
  });
});
