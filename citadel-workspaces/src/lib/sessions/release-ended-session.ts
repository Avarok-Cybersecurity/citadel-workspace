/**
 * A tab stops holding a session once the agent says it ended.
 *
 * The session a tab holds is what it announces to the other tabs (cid-update, and its answer
 * to every cid-report-request), and the leader claims each announced session on every new
 * connection (follower-session-claims.ts). Signing out cleared the tab's selection and left
 * that announcement standing, so a tab back on the landing page went on naming a session the
 * agent had removed: each new leader connection claimed it and was answered "Session <cid> not
 * found", and messages for the account, signed in again in another tab, were still routed here.
 *
 * The agent says a session ended in one way whoever ended it — this tab, another window,
 * its server, or a deletion (session-ended.ts) — and every tab hears it, so one listener
 * covers every path out.
 */
import { sessionEnded, type SessionEnded } from './session-ended';

export interface EndedSessionReleaseDeps {
  on: (event: string, handler: (payload: unknown) => void) => void;
  /** The session this tab holds, or null. */
  heldCid: () => bigint | null;
  /** Hold nothing, and tell the other tabs so. */
  release: () => void;
}

/**
 * Sessions this tab has heard end, until it holds one of them again (the CID is permanent, so
 * signing in again holds the same one). A tab that kept the page for unsaved text still has
 * the ended session selected, and the instance channel answers a report from the selection
 * when it holds nothing; this is how it tells that selection is stale.
 */
const heardEnded: Set<bigint> = new Set<bigint>();

export function hasHeardEnd(cid: bigint): boolean {
  return heardEnded.has(cid);
}

export function installEndedSessionRelease(deps: EndedSessionReleaseDeps): void {
  deps.on('websocket-message', (message: unknown): void => {
    const ended: SessionEnded | null = sessionEnded(message);
    if (ended === null) return;
    heardEnded.add(ended.cid);
    if (ended.cid === deps.heldCid()) deps.release();
  });
  deps.on('instance:cid-changed', (payload: unknown): void => {
    const cid: unknown = (payload as { cid?: unknown } | null)?.cid;
    if (typeof cid === 'bigint') heardEnded.delete(cid);
  });
}
