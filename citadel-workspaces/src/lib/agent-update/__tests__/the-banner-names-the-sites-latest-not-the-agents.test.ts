/**
 * The banner names the release the site says is latest, not what a stale agent offers
 * (2026-11-18: an agent on 0.11.0 offered 0.12.1 two hours after 0.13.0 shipped). Restart is
 * offered only for exactly that version, ready; otherwise the download of that version here.
 */
import { describe, it, expect } from 'vitest';
import { bannerFor, downloadFor } from '../banner-model';
import { fromAvailable, type AgentUpdate } from '../update-state';
import { isAtLeast, isNewer, parseVersion } from '../agent-version';
import { available, RELEASE } from './fake-updater';

const offer = (latest: string, ready: boolean, current: string = '0.11.0'): AgentUpdate =>
  ({ ...(fromAvailable(available(ready, latest)) as AgentUpdate), current });

describe('the agent update banner model', () => {
  it('names the site latest when the agent still offers the release before it', () => {
    const banner = bannerFor({ released: '0.13.0', current: '0.11.0', offer: offer('0.12.1', true), family: 'mac' });
    expect(banner).toMatchObject({ latest: '0.13.0', current: '0.11.0', restart: false, stale: true });
    expect(banner?.downloadUrl).toBe(`${RELEASE}download/agent-v0.13.0/Citadel-Agent.dmg`);
  });

  it('offers the restart once the agent has that very release ready', () => {
    const banner = bannerFor({ released: '0.13.0', current: '0.11.0', offer: offer('0.13.0', true), family: 'mac' });
    expect(banner).toMatchObject({ latest: '0.13.0', restart: true, stale: false });
  });

  it('downloads that release where the agent cannot install it itself, with the agent\'s own link', () => {
    const linux: AgentUpdate = offer('0.13.0', false);
    const banner = bannerFor({ released: '0.13.0', current: '0.11.0', offer: linux, family: 'linux' });
    expect(banner).toMatchObject({ restart: false, stale: false, downloadUrl: linux.downloadUrl });
  });

  it('shows the site latest even before the agent offers anything', () => {
    const banner = bannerFor({ released: '0.13.0', current: '0.12.1', offer: null, family: 'windows' });
    expect(banner).toMatchObject({ latest: '0.13.0', restart: false, stale: true });
    expect(banner?.downloadUrl).toBe(`${RELEASE}download/agent-v0.13.0/Citadel-Agent-x64.msi`);
  });

  it('shows nothing when the agent runs the latest, or before it has said what it runs', () => {
    expect(bannerFor({ released: '0.13.0', current: '0.13.0', offer: null, family: 'mac' })).toBeNull();
    expect(bannerFor({ released: '0.13.0', current: null, offer: null, family: 'mac' })).toBeNull();
  });

  it('falls back to the agent\'s offer where the site names no release', () => {
    expect(bannerFor({ released: null, current: '0.11.0', offer: offer('0.12.1', true), family: 'mac' }))
      .toMatchObject({ latest: '0.12.1', restart: true });
  });

  it('links the release page where no single installer fits', () => {
    expect(downloadFor('0.13.0', null, 'linux')).toBe(`${RELEASE}tag/agent-v0.13.0`);
    expect(downloadFor('0.13.0', null, undefined)).toBe(`${RELEASE}tag/agent-v0.13.0`);
  });

  it('compares versions as numbers, as the agent does', () => {
    expect(isNewer('0.13.0', '0.9.9')).toBe(true);
    expect(isNewer('0.12.1', '0.13.0')).toBe(false);
    expect(isAtLeast('0.13.0', '0.13.0')).toBe(true);
    expect(parseVersion('0.13.0-rc.1')).toBeNull();
  });
});
