/**
 * /agent#about and /agent#updates select their tab; no agent means the install steps on both;
 * and the page is read from the agent, not assumed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Agent, { tabFromHash } from '../Agent';
import { agentUpdate, updaterSettings } from '@/lib/agent-update/update-state';
import { registerConversationSender } from '@/lib/agent-conversations/sender';
import { available, fakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

beforeEach(() => { agentUpdate.set(null); updaterSettings.set(null); });

const at = (hash: string): JSX.Element => <MemoryRouter initialEntries={[`/agent${hash}`]}><Agent /></MemoryRouter>;

describe('the agent page', () => {
  it('reads the tab from the hash, About by default', () => {
    expect(tabFromHash('#updates')).toBe('updates');
    expect(tabFromHash('#about')).toBe('about');
    expect(tabFromHash('#apps')).toBe('apps');
    expect(tabFromHash('')).toBe('about');
    expect(tabFromHash('#nonsense')).toBe('about');
  });

  it('#updates opens the Updates tab with the full status', async () => {
    fakeUpdater(available(true));
    render(at('#updates'));
    expect(await screen.findByTestId('agent-update-status')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('agent-tab-updates')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('agent-version-card')).toBeNull();
  });

  it('#about opens About: version, verified badge, links, a compact status and the workspace build', async () => {
    fakeUpdater(null);
    render(at('#about'));
    expect(await screen.findByTestId('agent-version-card')).toHaveTextContent('0.8.8');
    expect(screen.getByTestId('agent-verified-badge')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download page/ })).toHaveAttribute('href', expect.stringContaining('releases'));
    expect(screen.getByTestId('agent-logs-hint')).toHaveTextContent('Show logs');
    expect(screen.getByTestId('agent-workspace-build')).toBeInTheDocument();
    expect(screen.getAllByText('Citadel Agent is up to date')[0]).toBeInTheDocument();
  });

  it('View updates moves from About to Updates', async () => {
    fakeUpdater(null);
    render(at('#about'));
    fireEvent.click(await screen.findByTestId('agent-open-updates'));
    expect(await screen.findByTestId('agent-tab-updates')).toHaveAttribute('aria-selected', 'true');
  });

  it('with no agent answering, both tabs say to install it and show the install steps', async () => {
    registerConversationSender(async (): Promise<void> => { throw new Error('socket closed'); });
    const first: RenderResult = render(at('#about'));
    expect(await screen.findByText('Install the Citadel Agent to see its version and updates')).toBeInTheDocument();
    expect(screen.getByTestId('agent-setup')).toBeInTheDocument();
    first.unmount();
    render(at('#updates'));
    expect(await screen.findByText('Install the Citadel Agent to see its version and updates')).toBeInTheDocument();
    expect(screen.getByTestId('agent-setup')).toBeInTheDocument();
  });

  it('NEGATIVE CONTROL: with an agent, the install steps are not shown', async () => {
    fakeUpdater(null);
    render(at('#updates'));
    await screen.findByTestId('agent-update-status');
    expect(screen.queryByTestId('agent-missing')).toBeNull();
  });
});
