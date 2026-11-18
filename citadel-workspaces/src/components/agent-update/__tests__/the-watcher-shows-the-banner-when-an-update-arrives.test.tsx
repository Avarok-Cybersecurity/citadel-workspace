/**
 * The watcher (loaded lazily by the app, so the banner is off the landing page's critical
 * path) shows nothing until the agent announces a newer release, and then the banner. The
 * announcement arrives on the app's event emitter, as the agent's do.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentUpdateWatcher } from '../AgentUpdateWatcher';
import { eventEmitter } from '@/lib/event-emitter';
import { agentUpdate, fromAvailable, updaterSettings } from '@/lib/agent-update/update-state';
import { releasedAgent } from '@/lib/agent-update/released-agent';
import { restartPhase } from '@/lib/agent-update/restart-controller';
import { available, fakeUpdater, type FakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

beforeEach(() => {
  agentUpdate.set(null);
  updaterSettings.set(null);
  releasedAgent.set(null);
  restartPhase.set({ kind: 'idle' });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** The site's /version.json, naming `agent` as the latest release. */
function site(agent: string): void {
  vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> =>
    new Response(JSON.stringify({ entry: '/assets/index-x.js', seq: 1, agent }), { status: 200 })));
}

describe('the agent update watcher', () => {
  it('shows nothing until an UpdateAvailable arrives, then the banner', async () => {
    fakeUpdater(null);
    render(<MemoryRouter><AgentUpdateWatcher /></MemoryRouter>);
    expect(screen.queryByTestId('agent-update-banner')).toBeNull();
    act(() => { eventEmitter.emit('websocket-message', { UpdateAvailable: available(true) }); });
    expect(await screen.findByTestId('agent-update-banner')).toHaveTextContent('Citadel Agent 0.9.0 is available');
  });

  it('stays out of the way on the /agent page, which shows the same update in full', async () => {
    fakeUpdater(available(true));
    agentUpdate.set(fromAvailable(available(true)));
    const { rerender } = render(<MemoryRouter initialEntries={['/agent']}><AgentUpdateWatcher /></MemoryRouter>);
    expect(screen.queryByTestId('agent-update-banner')).toBeNull();
    // NEGATIVE CONTROL: the same update, anywhere else, is the banner.
    rerender(<MemoryRouter key="elsewhere" initialEntries={['/messages']}><AgentUpdateWatcher /></MemoryRouter>);
    expect(await screen.findByTestId('agent-update-banner')).toBeInTheDocument();
  });

  it('names the site latest, not the release a stale agent offers, and asks the agent to catch up', async () => {
    site('0.13.0');
    const agent: FakeUpdater = fakeUpdater(available(true, '0.12.1'));
    agent.status = { ...agent.status, current: '0.11.0' };
    render(<MemoryRouter><AgentUpdateWatcher /></MemoryRouter>);
    const banner: HTMLElement = await screen.findByText('Citadel Agent 0.13.0 is available');
    expect(banner.closest('[data-testid="agent-update-banner"]')).not.toHaveTextContent('0.12.1');
    expect(screen.queryByTestId('agent-update-restart')).toBeNull();
    expect(screen.getByTestId('agent-update-download')).toHaveTextContent('Download 0.13.0');
    expect(agent.asked.map(([v]) => v)).toContain('UpdateCheckNow');
    // NEGATIVE CONTROL: once the agent has that release ready, the restart is offered for it.
    act(() => { eventEmitter.emit('websocket-message', { UpdateAvailable: { ...available(true, '0.13.0'), current: '0.11.0' } }); });
    expect(await screen.findByTestId('agent-update-restart')).toBeInTheDocument();
  });
});
