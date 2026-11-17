import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `isDiagnosticsUiEnabled` short-circuits to true under `import.meta.env.DEV`,
 * which vitest sets. These cover the production branch — the one that decides
 * whether an end user sees internal multi-tab state — by stubbing DEV off.
 */
async function loadWithProdEnv(): Promise<() => boolean> {
  vi.stubEnv('DEV', false);
  vi.resetModules();
  return (await import('../debug-config')).isDiagnosticsUiEnabled;
}

describe('isDiagnosticsUiEnabled', () => {
  const originalSearch: string = window.location.search;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    window.history.replaceState({}, '', originalSearch || '/');
    window.localStorage.clear();
  });

  it('is enabled in development without any opt-in', async () => {
    vi.resetModules();
    const { isDiagnosticsUiEnabled } = await import('../debug-config');
    expect(isDiagnosticsUiEnabled()).toBe(true);
  });

  it('is off by default in production, so users never see internal state', async () => {
    const isEnabled: () => boolean = await loadWithProdEnv();
    expect(isEnabled()).toBe(false);
  });

  it('can be turned on in production with ?diagnostics=1 for support', async () => {
    window.history.replaceState({}, '', '/?diagnostics=1');
    const isEnabled: () => boolean = await loadWithProdEnv();
    expect(isEnabled()).toBe(true);
  });

  it('can be turned on persistently via localStorage', async () => {
    window.localStorage.setItem('citadel:diagnostics', 'true');
    const isEnabled: () => boolean = await loadWithProdEnv();
    expect(isEnabled()).toBe(true);
  });

  it('treats any other stored value as off', async () => {
    window.localStorage.setItem('citadel:diagnostics', 'yes');
    const isEnabled: () => boolean = await loadWithProdEnv();
    expect(isEnabled()).toBe(false);
  });

  it('stays off rather than throwing when storage is unavailable', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((): never => {
      throw new Error('storage partitioned');
    });
    const isEnabled: () => boolean = await loadWithProdEnv();
    expect(isEnabled()).toBe(false);
    spy.mockRestore();
  });
});
