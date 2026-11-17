import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `isOnboardingEnabled` is the inverse of the diagnostics gate: OFF in the
 * environment vitest and Playwright run in, ON in production.
 *
 * That inversion is the whole point, so it is what these tests pin. The
 * integration suite creates an account for nearly every spec — 9 UI
 * interactions each, 11 for the first user — and a tour rendered on top of
 * that would be clicked through ~90 times per run to assert nothing.
 *
 * Both directions are covered deliberately. A gate that is merely "off in dev"
 * would pass a dev-only suite while never having been shown to a single user;
 * a gate that is merely "on in prod" would pass while making every test pay
 * for it. Neither half is sufficient on its own.
 */
async function loadWith(dev: boolean): Promise<() => boolean> {
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return (await import('../debug-config')).isOnboardingEnabled;
}

describe('isOnboardingEnabled', () => {
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

  it('is OFF in development, so the suite does not pay for it', async () => {
    const enabled: () => boolean = await loadWith(true);
    expect(enabled()).toBe(false);
  });

  it('is ON in production, where a first-time operator needs it', async () => {
    const enabled: () => boolean = await loadWith(false);
    expect(enabled()).toBe(true);
  });

  it('can be forced on in development by ?onboarding=1', async () => {
    window.history.replaceState({}, '', '/?onboarding=1');
    const enabled: () => boolean = await loadWith(true);
    expect(enabled()).toBe(true);
  });

  it('can be forced on in development by localStorage', async () => {
    window.localStorage.setItem('citadel:onboarding', 'true');
    const enabled: () => boolean = await loadWith(true);
    expect(enabled()).toBe(true);
  });

  // The off-switch is what lets a PRODUCTION Playwright run create its fixture
  // accounts cheaply and opt in only for the specs under test. Without it,
  // testing onboarding against a production build would make every setup
  // account click through the tour again.
  it('?onboarding=0 wins over production', async () => {
    window.history.replaceState({}, '', '/?onboarding=0');
    const enabled: () => boolean = await loadWith(false);
    expect(enabled()).toBe(false);
  });

  it('?onboarding=0 wins over the localStorage opt-in', async () => {
    window.localStorage.setItem('citadel:onboarding', 'true');
    window.history.replaceState({}, '', '/?onboarding=0');
    const enabled: () => boolean = await loadWith(false);
    expect(enabled()).toBe(false);
  });

  // A sandboxed context throws on localStorage access. That must fall through
  // to the environment default, not be read as an opt-out — otherwise
  // onboarding would silently vanish in production for partitioned storage.
  it('falls back to the environment default when storage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((): never => {
      throw new Error('storage partitioned');
    });
    try {
      expect((await loadWith(false))()).toBe(true);
      expect((await loadWith(true))()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
