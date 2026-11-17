/**
 * Everything in `BROADCAST_MESSAGE_TYPES` is exempt from cid filtering — the
 * router fans it out to every tab, and `notificationCid()` treats it as
 * addressed to nobody. Membership must therefore be deliberate.
 *
 * 'ServerResponse' sat on that list matching no variant of the generated
 * `InternalServiceResponse` union: dead as written, but a standing exemption
 * waiting for a future variant of that name to bypass the cid filter by
 * accident. The list now carries `satisfies ResponseType[]`, so a non-variant
 * entry fails to compile; these runtime pins are the half vitest can see.
 */
import { describe, it, expect } from 'vitest';
import type { ResponseType } from 'citadel-workspace-client-ts';
import { BROADCAST_MESSAGE_TYPES, shouldBroadcast } from '../routing-rules';

describe('BROADCAST_MESSAGE_TYPES', () => {
  it('contains exactly the deliberate fan-outs, and no fewer', () => {
    // Written out rather than derived, so adding or removing a fan-out is a
    // deliberate edit in two places — same convention as the
    // CID_ROUTED_NOTIFICATIONS pin next door.
    expect([...BROADCAST_MESSAGE_TYPES].sort()).toEqual(
      ['DeregisterSuccess', 'DisconnectNotification', 'UpdateAvailable'].sort(),
    );
  });

  it('does not exempt a message keyed ServerResponse from cid filtering', () => {
    // The consequence the dead entry armed: any message whose first key
    // happened to be 'ServerResponse' would have been fanned out to every
    // tab, cid unchecked.
    expect(shouldBroadcast('ServerResponse' as ResponseType)).toBe(false);
  });

  it('still fans out a disconnect', () => {
    // Positive control: an emptied list would pass the assertion above.
    expect(shouldBroadcast('DisconnectNotification')).toBe(true);
  });

  it('fans out an agent update to every tab, signed in or not', () => {
    // UpdateAvailable carries cid 0: filtered by cid, every signed-in follower dropped it.
    expect(shouldBroadcast('UpdateAvailable')).toBe(true);
  });
});
