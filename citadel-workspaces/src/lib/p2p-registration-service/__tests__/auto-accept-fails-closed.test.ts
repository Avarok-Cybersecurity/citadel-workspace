/**
 * An unreadable auto-accept preference must never auto-accept.
 *
 * `getAutoAcceptSetting` classifies its failure with `isGenuinelyAbsent` and
 * then returns `false` on BOTH branches — the shape that, in
 * `server-auto-connect-service`, meant "the predicate was imported, the
 * distinction was drawn in the log message, and the BEHAVIOUR was identical on
 * both branches".
 *
 * Here the identical behaviour is correct, and that is exactly why it needs
 * pinning. `false` sends the incoming registration to the pending list, where
 * the user sees it and decides. Failing the other way — auto-accepting a peer
 * because a LocalDB read timed out — is a P2P trust decision made by a network
 * hiccup, and it cannot be undone.
 *
 * So this file exists to make that direction load-bearing: an edit that made a
 * failed read fail OPEN would be a security change disguised as a refactor,
 * and nothing else in the suite would notice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let getBehaviour: 'absent' | 'timeout' | 'on' = 'absent';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (): Promise<{ value: number[] } | null> => {
      if (getBehaviour === 'timeout') throw new Error('LocalDB request timed out after 5000ms');
      if (getBehaviour === 'absent') throw new Error('Key not found: auto_accept');
      return { value: Array.from(new TextEncoder().encode('true')) };
    },
    sendLocalDBSet: async (): Promise<void> => undefined,
  },
}));

import { getAutoAcceptSetting } from '../connection';

describe('the auto-accept preference', () => {
  beforeEach(() => { getBehaviour = 'absent'; });

  it('is off when the key is genuinely absent', async () => {
    getBehaviour = 'absent';
    expect(await getAutoAcceptSetting(111n)).toBe(false);
  });

  it('is off when the read FAILED, not merely when it found nothing', async () => {
    getBehaviour = 'timeout';
    expect(
      await getAutoAcceptSetting(111n),
      'a timed-out read must not auto-accept a peer',
    ).toBe(false);
  });

  it('is on when the stored value says so', async () => {
    // The discrimination. Without this the two assertions above are satisfied
    // by a function that returns false unconditionally, which would measure
    // nothing at all.
    getBehaviour = 'on';
    expect(await getAutoAcceptSetting(111n)).toBe(true);
  });

  it('is off for a caller with no session, without reading anything', async () => {
    getBehaviour = 'on';
    expect(await getAutoAcceptSetting(0n)).toBe(false);
  });
});
