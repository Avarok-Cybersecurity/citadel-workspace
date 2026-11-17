/**
 * What the agent says about a newer release reaches the banner's and the settings row's
 * stores, from the broadcast and from a status answer alike, and only with this project's
 * release links.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { UpdateStatus } from 'citadel-internal-service-wasm-client';
import { agentUpdate, applyUpdaterMessage, isReleaseLink, updaterSettings } from '../update-state';
import { available, RELEASE } from './fake-updater';

beforeEach(() => { agentUpdate.set(null); updaterSettings.set(null); });

describe('updater messages', () => {
  it('an UpdateAvailable broadcast, wrapped or not, becomes the update shown', () => {
    applyUpdaterMessage({ Response: { UpdateAvailable: available(true) } });
    expect(agentUpdate.get()).toMatchObject({ latest: '0.9.0', current: '0.8.8', ready: true });
    applyUpdaterMessage({ UpdateAvailable: available(false, '0.9.1') });
    expect(agentUpdate.get()).toMatchObject({ latest: '0.9.1', ready: false });
  });

  it('a status answer sets the settings and the update, and clears an update that is gone', () => {
    applyUpdaterMessage({ UpdateAvailable: available(true) });
    const status: UpdateStatus = { cid: 0n, current: '0.9.0', available: null, auto_install: false, last_checked: 5n, last_error: 'offline', request_id: 'r' };
    applyUpdaterMessage({ UpdateStatus: status });
    expect(updaterSettings.get()).toEqual({ current: '0.9.0', autoInstall: false, lastChecked: 5n, lastError: 'offline' });
    expect(agentUpdate.get()).toBeNull();
  });

  it('an update whose links are not this project\'s releases is not shown', () => {
    applyUpdaterMessage({ UpdateAvailable: { ...available(false), download_url: 'https://evil.example/agent.dmg' } });
    expect(agentUpdate.get()).toBeNull();
    expect(isReleaseLink(`${RELEASE}download/agent-v0.9.0/x`)).toBe(true);
    expect(isReleaseLink('https://github.com/someone/citadel-workspace/releases/x')).toBe(false);
    expect(isReleaseLink(`${RELEASE}../../../evil`)).toBe(false);
  });

  it('anything else is left alone', () => {
    applyUpdaterMessage({ UpdateAvailable: available(true) });
    applyUpdaterMessage({ MessageNotification: { cid: 1n } });
    applyUpdaterMessage(null);
    expect(agentUpdate.get()).toMatchObject({ latest: '0.9.0' });
    expect(updaterSettings.get()).toBeNull();
  });
});
