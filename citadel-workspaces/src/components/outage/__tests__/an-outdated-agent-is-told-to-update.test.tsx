/**
 * A workspace that will not come back while this computer's agent is older than the site's
 * release is the agent's to fix: the page says to update it, and never "the error is on us".
 *
 * A server that speaks a newer protocol refuses an older agent, and an agent old enough to
 * predate that refusal's code only ever reports "reconnecting" and then "unreachable". This is
 * what its user sees meanwhile.
 *
 * Control: make `outageView` return the service's page whatever the agent's version, and the
 * first test shows "The error is on us".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OutageNotice } from '../OutageNotice';
import { releasedAgent } from '@/lib/agent-update/released-agent';
import { agentUpdate, updaterSettings, type UpdaterSettings } from '@/lib/agent-update/update-state';
import { outageView, PROTOCOL_STEPS_WITH_AN_UPDATE_NOTICE, UPDATE_AGENT_COPY, type OutageView } from '@/lib/reconnect/outdated-agent';
import { OUTAGE_TITLE } from '@/lib/reconnect/outage';
import type { AgentBanner } from '@/lib/agent-update/banner-model';

vi.mock('@/lib/agent-update/requests', () => ({ askUpdater: vi.fn(async (): Promise<never> => { throw new Error('no agent socket in this test'); }) }));

const RELEASED: string = '0.15.5';

function running(current: string): UpdaterSettings {
  return { current, autoInstall: false, lastChecked: null, lastError: null };
}

/** `/version.json` as the site serves it after a deploy. */
function siteNames(agent: string): void {
  vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ entry: 'e.js', seq: 1, agent }), { status: 200 })));
}

describe('the page in place of a workspace that cannot be reached', () => {
  beforeEach(() => {
    siteNames(RELEASED);
    releasedAgent.set(null);
    agentUpdate.set(null);
    updaterSettings.set(null);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('tells the user of an outdated agent to update it, for every kind of outage', async () => {
    for (const kind of ['reconnect-slow', 'server-unreachable', 'workspace-timeout'] as const) {
      updaterSettings.set(running('0.15.1'));
      render(<OutageNotice kind={kind} onRetry={(): void => undefined} />);
      await waitFor(() => expect(screen.getByTestId('update-agent-notice')).toBeTruthy());
      const said: string = screen.getByRole('alert').textContent ?? '';
      expect(said).toContain(UPDATE_AGENT_COPY.title);
      expect(said).toContain(UPDATE_AGENT_COPY.detail('0.15.1', RELEASED));
      for (const title of Object.values(OUTAGE_TITLE)) expect(said).not.toContain(title);
      expect(screen.queryByTestId('service-unavailable')).toBeNull();
      const download: HTMLElement = screen.getByTestId('update-agent-download');
      expect(download.textContent).toBe(`Download ${RELEASED}`);
      expect(download.getAttribute('href') ?? '').toContain(RELEASED);
      cleanup();
      releasedAgent.set(null);
    }
  });

  it('still retries from the update notice', async () => {
    updaterSettings.set(running('0.15.1'));
    const retry: () => void = vi.fn();
    render(<OutageNotice kind="reconnect-slow" onRetry={retry} />);
    await waitFor(() => expect(screen.getByTestId('update-agent-notice')).toBeTruthy());
    fireEvent.click(screen.getByTestId('update-agent-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('says the failure is the service’s when the agent is the site’s release', async () => {
    updaterSettings.set(running(RELEASED));
    render(<OutageNotice kind="server-unreachable" onRetry={(): void => undefined} />);
    await waitFor(() => expect(releasedAgent.get()).toBe(RELEASED));
    expect(screen.getByTestId('service-unavailable-title').textContent).toBe(OUTAGE_TITLE['server-down']);
    expect(screen.queryByTestId('update-agent-notice')).toBeNull();
  });

  it('says the same when nothing says which agent runs, or what the site released', async () => {
    render(<OutageNotice kind="reconnect-slow" onRetry={(): void => undefined} />);
    await waitFor(() => expect(releasedAgent.get()).toBe(RELEASED));
    expect(screen.getByTestId('service-unavailable')).toBeTruthy();
    cleanup();

    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => new Response('<html></html>', { status: 200 })));
    releasedAgent.set(null);
    updaterSettings.set(running('0.15.1'));
    render(<OutageNotice kind="reconnect-slow" onRetry={(): void => undefined} />);
    expect(screen.getByTestId('service-unavailable')).toBeTruthy();
  });
});

describe('whose failure an outage is', () => {
  const newer: AgentBanner = { latest: RELEASED, current: '0.15.1', restart: false, downloadUrl: 'https://example.test/agent', stale: true };

  it('is the agent’s when a newer release exists, and keeps the outage’s code', () => {
    const view: OutageView = outageView('server-unreachable', newer);
    expect(view).toEqual({ kind: 'update-agent', outage: 'server-unreachable', latest: RELEASED, current: '0.15.1', downloadUrl: newer.downloadUrl, restart: false });
  });

  it('is listed for each protocol version a server kernel test asks about, as plain versions', () => {
    expect(PROTOCOL_STEPS_WITH_AN_UPDATE_NOTICE.length).toBeGreaterThan(0);
    for (const step of PROTOCOL_STEPS_WITH_AN_UPDATE_NOTICE) expect(step).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the service’s otherwise', () => {
    expect(outageView('reconnect-slow', null)).toEqual({ kind: 'service', outage: 'reconnect-slow' });
  });
});
