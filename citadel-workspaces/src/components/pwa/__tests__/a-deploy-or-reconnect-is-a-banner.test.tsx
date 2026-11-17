/**
 * A deploy and a server reconnect are both shown as banners that stay up, and
 * the agent's reconnect notifications reach them through the real event path.
 *
 * Mocked, because neither exists in jsdom: the tab's own session record (kept in
 * IndexedDB, which jsdom lacks) and the P2P auto-connect service (it needs the
 * WASM client and an agent), and the workspace reload after a reconnect (it
 * sends workspace-protocol requests over that same agent socket). The banner,
 * the stores, the reader and the handler are the real ones.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const resetConnectionState: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
const connectToAllRegisteredPeers: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
const postAuthSetup: ReturnType<typeof vi.fn> = vi.fn(async () => undefined);
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: (cid: bigint): Promise<void> => postAuthSetup(cid) }));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    resetConnectionState: (): Promise<void> => resetConnectionState(),
    connectToAllRegisteredPeers: (): Promise<void> => connectToAllRegisteredPeers(),
  },
}));
/** When set, the next read of the tab's session waits for it: a slow IndexedDB read. */
let holdNextRead: Promise<void> | null = null;
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<unknown> => {
    const hold: Promise<void> | null = holdNextRead;
    holdNextRead = null;
    if (hold) await hold;
    return { selectedCid: 42n, selectedUsername: 'alice', selectedServerAddress: 'bench.work.avarok.net' };
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { OfflineBanner } from '../OfflineBanner';
import { ServerReconnectWatcher } from '@/components/ServerReconnectWatcher';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { clearDeployNoticeForTests, offerDeployNotice } from '@/lib/pwa/deploy-notice';
import { reconnectingTo } from '@/lib/reconnect/server-reconnect';
import { saveDraft, clearAllDraftsForTests } from '@/lib/chat/draft-store';
import { DRAFT_HANDOFF_KEY } from '@/lib/chat/draft-handoff';

function Where(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderApp(): void {
  render(
    // As App mounts it: inside the confirm provider, which leaving asks through.
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/workspace']}>
        <OfflineBanner />
        <ServerReconnectWatcher />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>,
  );
}

const settle: () => Promise<void> = async (): Promise<void> => { await act(async () => { for (let i: number = 0; i < 10; i += 1) await Promise.resolve(); }); };
const wire: (message: unknown) => Promise<void> = async (message: unknown): Promise<void> => { act(() => { eventEmitter.emit('websocket-message', message); }); await settle(); };

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  clearDeployNoticeForTests();
  reconnectingTo.set(null);
  clearAllDraftsForTests();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('a new deploy', () => {
  it('is a banner with a Reload button, not something that fades', async () => {
    const accept: ReturnType<typeof vi.fn> = vi.fn();
    renderApp();
    act(() => offerDeployNotice({ reason: 'deployed', accept }));
    expect(screen.getByTestId('deploy-banner').textContent).toContain('Update available');

    saveDraft('peer:bob', 'unsent');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(accept).toHaveBeenCalledOnce();
    // The draft went into the handoff before the reload was asked for.
    expect(window.sessionStorage.getItem(DRAFT_HANDOFF_KEY)).toContain('unsent');
  });
});

describe('the agent reconnecting to the server', () => {
  it('says so while it retries, and resumes P2P when it is back', async () => {
    renderApp();
    await wire({ ServerConnectionLost: { cid: 42n, reconnecting: true, request_id: null } });
    expect(screen.getByTestId('server-reconnecting-banner').textContent).toContain('Reconnecting to bench.work.avarok.net');

    await wire({ ServerReconnected: { cid: 42n, request_id: null } });
    expect(screen.queryByTestId('server-reconnecting-banner')).toBeNull();
    expect(resetConnectionState).toHaveBeenCalledOnce();
    expect(connectToAllRegisteredPeers).toHaveBeenCalledOnce();
    expect(postAuthSetup).toHaveBeenCalledWith(42n);
  });

  it('keeps the order it was told things in, even when a read is slow', async () => {
    renderApp();
    let release: () => void = () => undefined;
    holdNextRead = new Promise<void>((resolve: () => void) => { release = resolve; });
    act(() => {
      eventEmitter.emit('websocket-message', { ServerConnectionLost: { cid: 42n, reconnecting: true, request_id: null } });
      eventEmitter.emit('websocket-message', { ServerReconnected: { cid: 42n, request_id: null } });
    });
    await settle();
    release();
    await settle();
    expect(screen.queryByTestId('server-reconnecting-banner')).toBeNull();
  });

  it('sends the account to sign-in when the agent gives up', async () => {
    renderApp();
    await wire({ ServerReconnectFailed: { cid: 42n, reason: 'session expired', request_id: null } });
    expect(screen.getByTestId('where').textContent).toBe('/?account=alice&server=bench.work.avarok.net');
  });

  it('ignores another session', async () => {
    renderApp();
    await wire({ ServerConnectionLost: { cid: 7n, reconnecting: true, request_id: null } });
    await wire({ ServerReconnectFailed: { cid: 7n, reason: 'x', request_id: null } });
    expect(screen.queryByTestId('server-reconnecting-banner')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/workspace');
  });
});
