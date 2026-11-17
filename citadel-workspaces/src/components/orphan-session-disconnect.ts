/**
 * Whether a session can be signed out of, and what to say when it cannot.
 *
 * `ActiveSession.cid` is declared `bigint` and is not always present. The
 * loader in `useOrphanSessions` already guards `sel?.cid !== undefined` for
 * that reason; the disconnect path did not, so
 * `websocketService.disconnect(undefined)` was called, the loading modal ran
 * through to "ready", and the session was still in the strip afterwards. CI
 * reported it as
 *
 *   [OrphanSessionsNavbar] Disconnecting session: undefined
 *   prev_sess_b still in navbar: true
 *
 * -- three checks failing on an action that reported success. (That `undefined`
 * turned out to be Playwright rendering a bigint, not an absent CID; the guard
 * is still right for a session the wire really does send without one.)
 *
 * Its own module because the decision is worth testing on its own, and because
 * the hook it came from is at its length ceiling.
 */

/** Why a session cannot be disconnected, or `null` when it can. */
export function disconnectRefusal(cid: bigint | undefined): string | null {
  if (cid !== undefined) return null;
  return 'This session has no identifier, so it cannot be signed out of here. Reload and try again.';
}

import type { ClaimOutcome } from '@/lib/sessions/claim-session';
import { SESSION_OWNED_ELSEWHERE } from '@/lib/sessions/claim-session';

/**
 * Why a sign-out cannot proceed after trying to take the session over, or
 * `null` when it can.
 *
 * Signing out an orphan requires OWNING it first. The service's ownership gate
 * refuses any request for a session another connection holds, and an orphan's
 * holder is the connection that opened it — so this was refused every time, in
 * silence until round 309 and with an honest message after it. Claiming is the
 * designed way to take one over, and `handleNavigate` has always done it before
 * touching a session.
 *
 * One outcome is a genuine refusal and the rest are not. `already-active` means
 * the session is live and no tab of this browser holds it; the sign-out is then
 * worth attempting, and the service answers for itself if it disagrees.
 */
export function signOutRefusal(claim: ClaimOutcome): string | null {
  if (claim.status === 'owned-by-another-tab') return SESSION_OWNED_ELSEWHERE.description;
  // The agent refuses a sign-out from any connection but the holder's.
  if (claim.status === 'held-by-another-connection') return 'This account is open in another browser window. Sign out there, or use it here first.';
  return null;
}
