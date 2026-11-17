/**
 * Signing a session out, or deleting the account behind it.
 *
 * Extracted from `useOrphanSessions`, which is at its length ceiling and whose
 * job is holding state rather than running procedures. The sequence matters and
 * is the substance:
 *
 *  1. refuse a session with no CID, rather than calling `disconnect(undefined)`;
 *  2. CLAIM it — the service's ownership gate refuses any request for a session
 *     another connection holds, and an orphan's holder is the connection that
 *     opened it, so without this the request was refused every time;
 *  3. mark the user disconnected BEFORE the request, so auto-connect does not
 *     race the sign-out and bring the session back;
 *  4. stop the WASM client only if this session is the one it is running;
 *  5. tell the service; then invalidate, forget, and reload.
 */

import { debugLog } from '@/lib/debug-config';
import { claimSessionForThisTab, type ClaimOutcome } from '@/lib/sessions/claim-session';
import { disconnectRefusal, signOutRefusal } from './orphan-session-disconnect';

export type DisconnectAction = 'disconnect' | 'deregister';

/** What the sequence needs from the world. Injected so it can be tested. */
export interface SignOutIO {
  markUserDisconnected: (username: string, serverAddress: string) => Promise<void>;
  currentWasmCid: () => string | null;
  stopWasm: () => void;
  deregister: (cid: bigint) => Promise<void>;
  disconnect: (cid: bigint) => Promise<void>;
  invalidateSessionCache: () => void;
  removeSession: (username: string, serverAddress: string) => Promise<void>;
  /**
   * Drop this session from what is on screen, without asking anybody.
   *
   * `reload` re-queries the internal service, and that query can go
   * unanswered — `loadActiveSessions` treats a query with no answer as "keep
   * what you had", which is right in general: a timeout is not the answer "no
   * sessions", and the strip vanishing would make the user sign in again.
   *
   * It is wrong for the one session the user has just removed. CI caught it as
   * a deregistration that reported success, closed its modal, and left the row
   * exactly where it was — the re-query after a deregister was not answered,
   * so the list it kept was the list containing the account that had just been
   * deleted.
   *
   * The client does not need the server to tell it about the row it just
   * removed. This records that, and the next reload that DOES answer
   * reconciles everything else.
   */
  forget: (cid: bigint) => void;
  reload: () => Promise<void>;
}

export interface SignOutTarget {
  cid: bigint | undefined;
  username: string;
  serverAddress: string;
}

export type SignOutResult =
  | { status: 'done' }
  | { status: 'refused'; message: string }
  | { status: 'failed'; message: string };

/** Raised between the request and the reload, so the modal can say which. */
export type SignOutStage = 'cleaning';

export async function signOutSession(
  io: SignOutIO,
  target: SignOutTarget,
  action: DisconnectAction,
  onStage: (stage: SignOutStage) => void,
): Promise<SignOutResult> {
  const refusal: string | null = disconnectRefusal(target.cid);
  if (refusal !== null) {
    debugLog('SignOutSession', 'Refusing to disconnect a session with no CID', target.username);
    return { status: 'refused', message: refusal };
  }
  // `disconnectRefusal` is what establishes this, and the compiler cannot see
  // through a function boundary.
  const cid: bigint = target.cid as bigint;

  try {
    debugLog('SignOutSession', `${action === 'deregister' ? 'Deregistering' : 'Disconnecting'} session:`, cid);

    const claim: ClaimOutcome = await claimSessionForThisTab(cid);
    const claimRefusal: string | null = signOutRefusal(claim);
    if (claimRefusal !== null) return { status: 'refused', message: claimRefusal };

    await io.markUserDisconnected(target.username, target.serverAddress);

    if (io.currentWasmCid() === cid.toString()) io.stopWasm();

    if (action === 'deregister') await io.deregister(cid);
    else await io.disconnect(cid);

    io.invalidateSessionCache();
    await io.removeSession(target.username, target.serverAddress);

    onStage('cleaning');
    await io.reload();
    // AFTER the reload, and this is the whole point.
    //
    // It was before, and the reload put the row straight back: `reload` asks
    // the internal service for the session list, and a list fetched a moment
    // after a deregistration can still contain the session that was just
    // removed. CI showed exactly that -- `Deregister success: true` followed by
    // `still in navbar: true`, with the local removal undone by the query that
    // came after it.
    //
    // Last word rather than first: if the reload answers and correctly omits
    // this session, forgetting it again is a no-op; if the reload does not
    // answer, or answers with a list that has not caught up, the removal
    // stands. The request above succeeded, so the session is gone either way.
    io.forget(cid);
    return { status: 'done' };
  } catch (error) {
    debugLog('SignOutSession', `Failed to ${action}:`, error);
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
