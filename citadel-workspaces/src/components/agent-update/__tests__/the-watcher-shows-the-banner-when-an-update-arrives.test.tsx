/**
 * The watcher (loaded lazily by the app, so the banner is off the landing page's critical
 * path) shows nothing until the agent announces a newer release, and then the banner. The
 * announcement arrives on the app's event emitter, as the agent's do.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentUpdateWatcher } from '../AgentUpdateWatcher';
import { eventEmitter } from '@/lib/event-emitter';
import { agentUpdate, fromAvailable } from '@/lib/agent-update/update-state';
import { available, fakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

beforeEach(() => { agentUpdate.set(null); });

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
});
