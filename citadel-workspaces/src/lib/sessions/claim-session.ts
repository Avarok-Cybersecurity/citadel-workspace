/**
 * Taking ownership of a session for THIS tab.
 *
 * "Not orphaned" from the agent means somebody already has this session — and
 * that somebody may be another tab in this browser, not a stale server-side
 * record. Treating the refusal as success lets two tabs register the same CID,
 * and `findInstanceByCid` returns the first map hit: every CID-routed
 * notification (messages, transfer ticks, call media) goes to one tab while the
 * other renders the same conversation and silently never updates, with the
 * winner able to flip on re-registration.
 *
 * Round 153 fixed that — in the auto-claim path, and in none of the other
 * three: the workspace switcher, the orphan-sessions navbar, and the
 * post-login redirect all still swallowed the refusal and adopted. Four copies
 * of a check is how three of them come to differ, so this is the check, once.
 */

import { websocketService } from '../websocket-service';
import { instanceManager } from '../multi-instance';
import { debugLog } from '../debug-config';
import { agentHostsConversations } from '../agent-conversations/capabilities';

export type ClaimOutcome =
  /** The session was orphaned and is now ours. */
  | { status: 'claimed' }
  /** Live, and no other tab in this browser holds it — safe to select. */
  | { status: 'already-active' }
  /** Live, and another tab in this browser is using it. Do not adopt. */
  | { status: 'owned-by-another-tab'; instanceId: string }
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

/** Does another instance already own this CID? */
function otherTabOwns(cid: bigint): string | null {
  const owner: string | null = instanceManager.findInstanceByCid(cid);
  return owner && owner !== instanceManager.instanceId ? owner : null;
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

    // With an agent that hosts the account, several tabs may hold it at once:
    // the router hands every one of them what is addressed to the session, and
    // none of them writes the store. An older agent's browser ILM allows one.
    const owner: string | null = otherTabOwns(cid);
    if (owner && !(await agentHostsConversations())) {
      debugLog('ClaimSession', `${cid} is owned by instance ${owner}; not adopting`);
      return { status: 'owned-by-another-tab', instanceId: owner };
    }

    if (!(await heldHere(cid))) {
      // A browser that opened this session here once before joins again, beside
      // the window that holds it, without being asked (agent 0.8.6).
      if ((await agentHostsConversations()) && (await rejoinWithToken(cid))) {
        debugLog('ClaimSession', `${cid} is live on another connection; joined it here too`);
        return { status: 'already-active' };
      }
      debugLog('ClaimSession', `${cid} is live on another connection; not adopting`);
      return { status: 'held-by-another-connection' };
    }
    debugLog('ClaimSession', `${cid} is live on this connection and unowned by a tab; selecting it`);
    return { status: 'already-active' };
  }
}

/** What to tell the user when another tab has it. */
export const SESSION_OWNED_ELSEWHERE: { readonly title: "Already Open Elsewhere"; readonly description: "This session is open in another tab. Switch to it, or pick a different session here."; } = {
  title: 'Already Open Elsewhere',
  description:
    'This session is open in another tab. Switch to it, or pick a different session here.',
} as const;
