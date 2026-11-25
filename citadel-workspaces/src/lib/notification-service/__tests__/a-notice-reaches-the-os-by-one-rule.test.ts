/**
 * The one rule for whether a notification reaches the system (os-decision.ts), every case: where
 * its source says it may go, whether the window is in front, and what the browser allows. The
 * owner's case is the row "always, in front, granted": a reminder sent to this device, falling due
 * while Citadel was in front, must show; it was skipped because only "not in front" ever showed.
 */
import { describe, expect, it } from 'vitest';
import { osDecision, type OsDecision, type OsPermission } from '../os-decision';
import type { OsReach } from '../types';

const PERMISSIONS: readonly OsPermission[] = ['granted', 'default', 'denied', 'unsupported'];

/** What the system is owed, before permission: whether the notice is for it at all. */
const FOR_THE_SYSTEM: Readonly<Record<OsReach, { inFront: boolean; away: boolean }>> = {
  never: { inFront: false, away: false },
  'when-away': { inFront: false, away: true },
  always: { inFront: true, away: true },
};

const ONCE_OWED: Readonly<Record<OsPermission, OsDecision>> = {
  granted: 'show', default: 'needs-permission', denied: 'blocked', unsupported: 'blocked',
};

describe('whether a notification reaches the system', () => {
  for (const reach of Object.keys(FOR_THE_SYSTEM) as OsReach[]) {
    for (const inFront of [true, false]) {
      for (const permission of PERMISSIONS) {
        const owed: boolean = inFront ? FOR_THE_SYSTEM[reach].inFront : FOR_THE_SYSTEM[reach].away;
        const expected: OsDecision = owed ? ONCE_OWED[permission] : 'skip';
        it(`${reach}, ${inFront ? 'in front' : 'away'}, permission ${permission}: ${expected}`, () => {
          expect(osDecision(reach, inFront, permission)).toBe(expected);
        });
      }
    }
  }

  it("shows the owner's reminder: sent to this device, Citadel in front, allowed", () => {
    expect(osDecision('always', true, 'granted')).toBe('show');
  });

  it('never shows a chat message over the window it arrived in (its toast covers it)', () => {
    expect(osDecision('when-away', true, 'granted')).toBe('skip');
  });
});
