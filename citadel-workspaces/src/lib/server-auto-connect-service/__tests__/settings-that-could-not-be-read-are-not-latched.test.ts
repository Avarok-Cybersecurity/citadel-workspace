/**
 * The service must not remember an answer it failed to obtain.
 *
 * The call-site half of `a-failed-read-is-not-a-preference`. Making the loaders
 * rethrow buys nothing while the caller catches and defaults — and `init()` did
 * exactly that: it set `isEnabled = true` and `isInitialized = true`. Since
 * `init()` returns early when initialised, that latched the wrong answer for the
 * whole session: one timed-out request and a user who turned auto-connect off
 * had it back on until they reloaded.
 *
 * Two properties, and the second is the one a loader fix alone cannot reach:
 * the service stays OFF while the preference is unknown, and stays
 * UNINITIALISED so the next call tries again.
 *
 * Unknown resolves to off rather than to the documented default of on because
 * the two errors are not symmetric: not connecting when the user wanted it is
 * visible and recoverable, connecting when they asked not to is neither.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadAutoConnectSettings, type AutoConnectSettings } from '../init-settings';

const TIMED_OUT = (): Error => new Error('LocalDB request timed out after 5000ms');

describe('loading the auto-connect settings', () => {
  it('stays off and uninitialised when the preference could not be read', async () => {
    const noted: unknown[] = [];
    const settings: AutoConnectSettings = await loadAutoConnectSettings(
      {
        loadEnabled: async (): Promise<boolean> => { throw TIMED_OUT(); },
        loadUserDisconnected: async (): Promise<Set<string>> => new Set(),
      },
      (e: unknown) => { noted.push(e); },
    );

    expect(settings.enabled).toBe(false);
    // The half a loader fix cannot reach: `init()` returns early on this, so a
    // `true` here is what latched the wrong answer for the whole session.
    expect(settings.initialized).toBe(false);
    expect(noted).toHaveLength(1);
  });

  it('stays off and uninitialised when the signed-out list could not be read', async () => {
    // The second loader matters as much: an empty set means "nobody signed out
    // of anything", which is what makes the service reconnect a session the
    // user deliberately left.
    const settings: AutoConnectSettings = await loadAutoConnectSettings(
      {
        loadEnabled: async (): Promise<boolean> => true,
        loadUserDisconnected: async (): Promise<Set<string>> => { throw TIMED_OUT(); },
      },
      () => {},
    );

    expect(settings.enabled).toBe(false);
    expect(settings.initialized).toBe(false);
  });

  it('honours a stored "off"', async () => {
    const settings: AutoConnectSettings = await loadAutoConnectSettings(
      {
        loadEnabled: async (): Promise<boolean> => false,
        loadUserDisconnected: async (): Promise<Set<string>> => new Set(['s1']),
      },
      () => {},
    );

    expect(settings.enabled).toBe(false);
    expect(settings.initialized).toBe(true);
    expect(settings.userDisconnectedSessions).toEqual(new Set(['s1']));
  });

  it('honours a stored "on", and reports itself initialised', async () => {
    // The control. A loader that answered off-and-uninitialised no matter what
    // would satisfy both failure cases above and never auto-connect at all.
    const notified: ReturnType<typeof vi.fn> = vi.fn();
    const settings: AutoConnectSettings = await loadAutoConnectSettings(
      {
        loadEnabled: async (): Promise<boolean> => true,
        loadUserDisconnected: async (): Promise<Set<string>> => new Set(),
      },
      notified,
    );

    expect(settings.enabled).toBe(true);
    expect(settings.initialized).toBe(true);
    expect(notified).not.toHaveBeenCalled();
  });
});
