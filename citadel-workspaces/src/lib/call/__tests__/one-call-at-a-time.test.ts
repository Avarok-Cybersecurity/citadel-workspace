/**
 * This tab owns exactly one call, and two paths ask whether it is free.
 *
 * The group entry path has refused a second call since it was written. The 1:1
 * path never did: the chat header gates its call buttons only on whether the
 * peer is connected, so from any OTHER conversation during an active call both
 * buttons were live. Pressing one re-entered `CallSession.start` with the
 * `starting` promise already settled, overwriting `localStream` and `pump`
 * WITHOUT stopping either — the first stream orphaned with the camera light on
 * until a page reload, two pumps feeding one encoder, and the original peer
 * never sent a CallEnd, evicted only by their own 20s silence timeout believing
 * the other side had vanished.
 *
 * One rule, one module, so the two answers cannot diverge again.
 */

import { describe, it, expect } from 'vitest';
import { callBusyReason } from '../call-busy';
import { groupCallEntryMode } from '../group-call-entry';
import type { CallState } from '../call-state';
import type { GroupCallEntryMode } from '@/lib/call/group-call-entry';
import { callHomeOf } from '../room-names';

function state(status: CallState['status'], roomId: string | null = null): CallState {
  return { status, home: callHomeOf(roomId, new Map<string, string>()), participants: new Map() } as unknown as CallState;
}

describe('whether a new call can start', () => {
  it('is free when there is no call at all', () => {
    expect(callBusyReason(null)).toBeNull();
  });

  it.each(['ringing-out', 'connecting', 'active'] as const)('is busy while %s', (status) => {
    expect(callBusyReason(state(status))).toBeTruthy();
  });

  it('names an incoming call specifically', () => {
    // "You are already in another call" would be wrong and confusing when the
    // user has not answered anything yet.
    expect(callBusyReason(state('ringing-in'))).toMatch(/incoming/i);
  });

  it.each(['ended', 'failed'] as const)('is free again once %s', (status) => {
    // A failed call still owes the user its error panel, but blocking a new
    // call on it would strand them with no way out.
    expect(callBusyReason(state(status))).toBeNull();
  });

  it('gives the group entry path the same answer it gives the 1:1 path', () => {
    // The divergence is the bug. If these ever disagree, one surface refuses a
    // call the other allows, and which one you get depends on where you clicked.
    // `ringing-in` belongs in this list and was missing from my first version;
    // control B — reintroducing the divergence for exactly that status — passed
    // against it. A completeness gap in a divergence test is the divergence.
    for (const status of [
      'ringing-in', 'ringing-out', 'connecting', 'active', 'ended', 'failed',
    ] as const) {
      const call: CallState = state(status, 'other-room');
      const mode: GroupCallEntryMode = groupCallEntryMode(call, 'this-room', 3, []);
      const busy: string | null = callBusyReason(call);

      expect(
        mode.kind === 'busy',
        `group entry and callBusyReason disagree about ${status}`,
      ).toBe(busy !== null);
      if (mode.kind === 'busy') expect(mode.reason).toBe(busy);
    }
  });
});
