/**
 * Taking a session for THIS tab.
 *
 * "Not orphaned" from the agent means somebody already has this session: this
 * connection, or another one. Several tabs may hold an account at once -- the
 * agent hosts its ILM and conversations, and the router hands every tab what is
 * addressed to the session -- but a session live on ANOTHER connection is not
 * this socket's, and is joined (with a remembered token) or offered, never
 * adopted. The workspace switcher, the orphan-sessions navbar, the post-login
 * redirect and the auto-claim all ask here, so the check is made once.
 */

import { websocketService } from '../websocket-service';
import { debugLog } from '../debug-config';

export type ClaimOutcome =
  /** The session was orphaned and is now ours. */
  | { status: 'claimed' }
  /** Live on this connection — safe to select. */
  | { status: 'already-active' }
  /**
   * Live on ANOTHER localhost connection: another browser window, or one the
   * agent still holds after it dropped. This tab's socket does not carry it, so
   * selecting it here showed a workspace that never answered. The agent refuses
   * an unauthenticated takeover (`ClaimSession { only_if_orphaned: false }` is
   * "in use by another connection"); signing in with the password moves it.
   */
  | { status: 'held-by-another-connection' };

/** The agent's refusal meaning a live connection already owns the session. Read here, once. */
export function isOwnedByALiveConnection(error: unknown): boolean {
  return error instanceof Error && Boolean(error.message?.includes('not orphaned'));
}

/**
 * The agent's refusal meaning it no longer has the session: it found no SDK session for
 * it and removed it before answering. Seen live for a session it was still reconnecting
 * after a server drop -- the claim itself ended it -- so only signing in brings it back.
 */
export function isEndedByTheAgent(error: unknown): error is Error {
  return error instanceof Error && Boolean(error.message?.includes('is not claimable'));
}

/**
 * Any refusal meaning the agent holds no session for the CID: the one above, or
 * "Session <cid> not found" from ClaimSession and AttachSession -- what an account
 * signed out, deleted elsewhere, or ended by an agent restart answers.
 */
export function isGoneFromTheAgent(error: unknown): boolean {
  return isEndedByTheAgent(error) || (error instanceof Error && /\bSession \d+ not found\b/.test(error.message));
}

/** The agent's refusal meaning a DIFFERENT localhost connection holds the session. */
function isHeldByAnotherConnection(error: unknown): boolean {
  return error instanceof Error && Boolean(error.message?.includes('in use by another connection'));
}

/**
 * Whether the live connection holding `cid` is this socket or another one.
 * Re-asserting a session this connection already holds is allowed and changes
 * nothing; for any other holder the agent refuses and nothing moves.
 */
async function heldHere(cid: bigint): Promise<boolean> {
  try {
    await websocketService.claimSession(cid, false);
    return true;
  } catch (error: unknown) {
    if (isHeldByAnotherConnection(error)) return false;
    throw error;
  }
}

/** The silent rejoin, loaded only when a session is held elsewhere (off the landing path). */
async function rejoinWithToken(cid: bigint): Promise<boolean> {
  const { browserAttach, joinWithRememberedToken } = await import('./attach-session');
  return joinWithRememberedToken(browserAttach, cid);
}

/**
 * Claim `cid` for this tab, or report why not.
 *
 * Throws for any failure that is NOT "not orphaned" — a claim that fails for
 * another reason is a real error and the caller should say so.
 */
export async function claimSessionForThisTab(cid: bigint): Promise<ClaimOutcome> {
  try {
    await websocketService.claimSession(cid, true);
    debugLog('ClaimSession', `Claimed ${cid} (was orphaned)`);
    return { status: 'claimed' };
  } catch (error: unknown) {
    if (!isOwnedByALiveConnection(error)) {
      throw error;
    }

    if (!(await heldHere(cid))) {
      // A browser that opened this session here once before joins again, beside
      // the window that holds it, without being asked.
      if (await rejoinWithToken(cid)) {
        debugLog('ClaimSession', `${cid} is live on another connection; joined it here too`);
        return { status: 'already-active' };
      }
      debugLog('ClaimSession', `${cid} is live on another connection; not adopting`);
      return { status: 'held-by-another-connection' };
    }
    debugLog('ClaimSession', `${cid} is live on this connection; selecting it`);
    return { status: 'already-active' };
  }
}
