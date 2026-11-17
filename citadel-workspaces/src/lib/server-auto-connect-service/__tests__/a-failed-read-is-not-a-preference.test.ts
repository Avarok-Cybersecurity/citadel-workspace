/**
 * A preference that could not be READ is not a preference.
 *
 * `sendLocalDBGet` rejects for both "no such key" and "the request timed out" /
 * "the socket is down". Both loaders here caught every rejection and returned
 * their default — `true` for enabled, an empty set for
 * user-disconnected-sessions — so one transient failure turned auto-connect
 * back ON for somebody who had turned it off, and made every session the user
 * had deliberately signed out of reconnectable again.
 *
 * The remarkable part is that this was already written down. `loadEnabledSetting`
 * carried the paragraph "A FAILED read means nothing at all -- and returning the
 * default there is how a user who turned auto-connect off finds it back on after
 * one timed-out request", `isGenuinelyAbsent` was imported, and the two branches
 * differed only in their LOG TEXT. The fix was described and never applied.
 *
 * And it was swallowed twice: `init()` caught whatever the loaders threw, set
 * `isEnabled = true` and `isInitialized = true`, which latched the wrong answer
 * for the rest of the session.
 *
 * Both directions at both layers. Without the absence cases, loaders that
 * rethrew everything would satisfy the failure cases and break every first boot,
 * where the key genuinely is not there yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbGet: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: dbGet,
    sendLocalDBSet: vi.fn(async () => undefined),
  },
}));

const { loadEnabledSetting, loadUserDisconnectedSessions } = await import('../persistence');

/** What the agent sends when a request times out, versus when a key is missing. */
const TIMED_OUT = (): Error => new Error('LocalDB request timed out after 5000ms');
const ABSENT = (): Error => new Error('Key not found');

describe('reading the auto-connect preference', () => {
  beforeEach(() => { dbGet.mockReset(); });

  it('rethrows a read that failed, rather than answering "enabled"', async () => {
    dbGet.mockRejectedValue(TIMED_OUT());
    await expect(loadEnabledSetting()).rejects.toThrow(/timed out/);
  });

  it('still defaults to enabled when nobody has chosen yet', async () => {
    // The control. A loader that rethrew everything would pass the test above
    // and break every first boot, where the key genuinely is not there.
    dbGet.mockRejectedValue(ABSENT());
    await expect(loadEnabledSetting()).resolves.toBe(true);
  });

  it('reads a stored "off" as off', async () => {
    dbGet.mockResolvedValue({ value: Array.from(new TextEncoder().encode('false')) });
    await expect(loadEnabledSetting()).resolves.toBe(false);
  });
});

describe('reading the sessions the user signed out of', () => {
  beforeEach(() => { dbGet.mockReset(); });

  it('rethrows a read that failed, rather than answering "nobody signed out"', async () => {
    dbGet.mockRejectedValue(TIMED_OUT());
    await expect(loadUserDisconnectedSessions()).rejects.toThrow(/timed out/);
  });

  it('still answers an empty set when nothing has been stored yet', async () => {
    dbGet.mockRejectedValue(ABSENT());
    await expect(loadUserDisconnectedSessions()).resolves.toEqual(new Set());
  });

  it('reads back what was stored', async () => {
    dbGet.mockResolvedValue({ value: Array.from(new TextEncoder().encode('["a","b"]')) });
    await expect(loadUserDisconnectedSessions()).resolves.toEqual(new Set(['a', 'b']));
  });
});
