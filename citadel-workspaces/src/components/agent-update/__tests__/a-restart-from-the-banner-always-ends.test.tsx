/**
 * The banner's "Restart to update" never hangs (2026-11-18: "restarting the agent…" for ever).
 * The clock is vitest's: the restart's deadline is a real setTimeout in the live ports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AgentUpdateBanner } from '../AgentUpdateBanner';
import { bannerFor } from '@/lib/agent-update/banner-model';
import { restartPhase } from '@/lib/agent-update/restart-controller';
import { RESTART_DEADLINE_MS } from '@/lib/agent-update/restart-flow';
import { eventEmitter } from '@/lib/event-emitter';
import { fromAvailable, updaterSettings, type AgentUpdate } from '@/lib/agent-update/update-state';
import { available, fakeUpdater, RELEASE, type FakeUpdater } from '@/lib/agent-update/__tests__/fake-updater';

const OLD: string = '0.11.0';
const NEW: string = '0.13.0';

function offer(): AgentUpdate {
  return { ...(fromAvailable(available(true, NEW)) as AgentUpdate), current: OLD };
}

function renderBanner(): void {
  const o: AgentUpdate = offer();
  render(<AgentUpdateBanner banner={bannerFor({ released: NEW, current: OLD, offer: o, family: 'mac' })} offer={o} family="mac" />);
}

/** The agent on 0.11.0: it answers every request, never with an error, and never restarts. */
function oldAgent(): FakeUpdater {
  const agent: FakeUpdater = fakeUpdater(available(true, NEW));
  agent.status = { ...agent.status, current: OLD };
  return agent;
}

async function restart(): Promise<void> {
  fireEvent.click(screen.getByTestId('agent-update-restart'));
  fireEvent.click(screen.getByTestId('agent-update-confirm'));
  await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  restartPhase.set({ kind: 'idle' });
  updaterSettings.set({ current: OLD, autoInstall: true, lastChecked: null, lastError: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('restart to update, from the banner', () => {
  it('that never returns reaches a failure with the download of that version', async () => {
    oldAgent();
    renderBanner();
    await restart();
    expect(screen.getByTestId('agent-update-banner')).toHaveTextContent('restarting the agent');
    await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(RESTART_DEADLINE_MS - 1_000); });
    expect(screen.getByTestId('agent-update-banner')).toHaveAttribute('data-phase', 'restarting');
    await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByTestId('agent-update-failed')).toHaveTextContent(`did not come back as ${NEW}`);
    const download: HTMLElement = screen.getByTestId('agent-update-failed-download');
    expect(download).toHaveTextContent(`Download ${NEW}`);
    expect(download).toHaveAttribute('href', `${RELEASE}download/agent-v${NEW}/Citadel-Agent.dmg`);
    expect(screen.queryByText('restarting the agent', { exact: false })).toBeNull();
  });

  it('that returns with the new version shows the update', async () => {
    const agent: FakeUpdater = oldAgent();
    agent.silent = true;
    renderBanner();
    await restart();
    agent.silent = false;
    agent.status = { ...agent.status, current: NEW, available: null };
    await act(async (): Promise<void> => {
      eventEmitter.emit('on-ws-connection-success');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('agent-update-updated')).toHaveTextContent(`Updated to Citadel Agent ${NEW}`);
    expect(screen.getByTestId('agent-update-banner')).toHaveTextContent(`Citadel Agent ${NEW} is installed`);
    await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(RESTART_DEADLINE_MS); });
    expect(screen.queryByTestId('agent-update-failed')).toBeNull();
  });
});
