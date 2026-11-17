/**
 * "Citadel Agent X.Y.Z is available": Restart to update says what it costs before it asks the
 * agent to install; Download links out when the agent cannot install it itself.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentUpdateBanner } from '../AgentUpdateBanner';
import { RESTART_WARNING } from '../RestartToUpdate';
import { fromAvailable, type AgentUpdate } from '@/lib/agent-update/update-state';
import { available, fakeUpdater, type FakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

const update = (ready: boolean): AgentUpdate => fromAvailable(available(ready)) as AgentUpdate;

describe('the agent update banner', () => {
  it('asks before restarting, says accounts will sign in again, then asks the agent to install', async () => {
    const agent: FakeUpdater = fakeUpdater(available(true));
    agent.silent = true;
    render(<AgentUpdateBanner update={update(true)} />);
    expect(screen.getByTestId('agent-update-banner')).toHaveTextContent('Citadel Agent 0.9.0 is available');
    fireEvent.click(screen.getByTestId('agent-update-restart'));
    expect(await screen.findByTestId('agent-update-warning')).toHaveTextContent(RESTART_WARNING);
    expect(RESTART_WARNING).toMatch(/sign in again/);
    expect(agent.asked).toEqual([]);
    fireEvent.click(screen.getByTestId('agent-update-confirm'));
    await waitFor(() => expect(agent.asked.map(([v]) => v)).toEqual(['UpdateApply']));
    expect(screen.getByTestId('agent-update-banner')).toHaveTextContent('restarting the agent');
  });

  it('cancelling the confirmation installs nothing', async () => {
    const agent: FakeUpdater = fakeUpdater(available(true));
    render(<AgentUpdateBanner update={update(true)} />);
    fireEvent.click(screen.getByTestId('agent-update-restart'));
    fireEvent.click(await screen.findByText('Cancel'));
    expect(agent.asked).toEqual([]);
  });

  it('shows why when the agent installed nothing', async () => {
    const agent: FakeUpdater = fakeUpdater(available(true));
    agent.status = { ...agent.status, last_error: 'Nothing was installed: Citadel Agent.app is not listening' };
    render(<AgentUpdateBanner update={update(true)} />);
    fireEvent.click(screen.getByTestId('agent-update-restart'));
    fireEvent.click(await screen.findByTestId('agent-update-confirm'));
    expect(await screen.findByText(/is not listening/)).toBeInTheDocument();
  });

  it('links the download when the agent cannot install it, and offers no restart', () => {
    render(<AgentUpdateBanner update={update(false)} />);
    const link: HTMLElement = screen.getByTestId('agent-update-download');
    expect(link).toHaveAttribute('href', update(false).downloadUrl);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByTestId('agent-update-restart')).toBeNull();
  });

  it('Later puts it away for this version', () => {
    render(<AgentUpdateBanner update={update(false)} />);
    fireEvent.click(screen.getByTestId('agent-update-later'));
    expect(screen.queryByTestId('agent-update-banner')).toBeNull();
  });
});
