/**
 * The agent's update settings: install automatically when nobody is signed in (on until
 * turned off), and Check now. The agent is a recorder answering on the app's event emitter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentUpdateRow } from '../AgentUpdateRow';
import { versionLine } from '@/lib/agent-update/version-line';
import { agentUpdate, updaterSettings, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { available, fakeUpdater, type FakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

beforeEach(() => { agentUpdate.set(null); updaterSettings.set(null); });

describe('agent update settings', () => {
  it('shows the agent\'s setting, on by default, and turning it off tells the agent', async () => {
    const agent: FakeUpdater = fakeUpdater(null);
    render(<AgentUpdateRow />);
    const toggle: HTMLElement = await screen.findByTestId('agent-auto-install');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(agent.asked.find(([v]) => v === 'UpdateSetSettings')?.[1]).toMatchObject({ auto_install: false });
  });

  it('Check now asks the agent and shows what it found', async () => {
    const agent: FakeUpdater = fakeUpdater(null);
    render(<AgentUpdateRow />);
    await screen.findByTestId('agent-update-settings');
    agent.status = { ...agent.status, available: available(true, '0.9.2') };
    fireEvent.click(screen.getByTestId('agent-update-check'));
    expect(await screen.findByText(/0\.9\.2 is available/)).toBeInTheDocument();
    expect(agent.asked.map(([v]) => v)).toContain('UpdateCheckNow');
  });

  it('is not shown by an agent without an updater', () => {
    const agent: FakeUpdater = fakeUpdater(null);
    agent.silent = true;
    const { container }: { container: HTMLElement } = render(<AgentUpdateRow />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the running version and when it last looked', () => {
    const settings: UpdaterSettings = { current: '0.8.8', autoInstall: true, lastChecked: null, lastError: null };
    expect(versionLine(settings, null)).toBe('Citadel Agent 0.8.8, up to date (not checked yet).');
    expect(versionLine(settings, { current: '0.8.8', latest: '0.9.0', notesUrl: '', downloadUrl: '', ready: true }))
      .toBe('Citadel Agent 0.8.8. 0.9.0 is available.');
  });
});
