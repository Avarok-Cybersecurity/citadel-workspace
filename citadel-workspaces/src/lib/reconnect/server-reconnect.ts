import type { AgentReconnectEvent } from '@/types/agent-reconnect';
import type { AdmissionReason } from '@/lib/admission/refusal';
import { accountLinkPath } from '@/lib/onboarding/account-link';
import { createValueStore, type ValueStore } from '@/lib/value-store';

/**
 * What this tab does when the agent reports on its link to the workspace server.
 *
 * A server deploy drops every client's connection. The agent now reconnects on
 * its own and says so; the page used to learn of it only as a burst of failed
 * requests. While the agent retries, the tab says "Reconnecting to <server>…";
 * when it is back, the P2P links the drop took down are brought up again; when
 * the agent gives up, the user is sent to sign in to that same account.
 *
 * Only this tab's own session counts. The notifications are routed by cid, but a
 * leader tab also sees ones no live tab claims, and acting on those would put
 * another account's banner on this one — so a cid that is not ours is ignored.
 */

/** The workspace server this tab is waiting on, or null when it is not waiting. */
export const reconnectingTo: ValueStore<string | null> = createValueStore<string | null>('reconnecting-to', null);

export interface OwnSession {
  cid: bigint;
  username: string;
  server: string;
}

export interface ServerReconnectIO {
  ownSession: () => Promise<OwnSession | null>;
  setReconnecting: (server: string | null) => void;
  /** Bring this session's P2P links back up after the server link returned. */
  resumePeers: () => Promise<void>;
  /**
   * Ask for this session's workspace again. Whatever was requested while the link was
   * down went nowhere: a page loaded during the drop never got its workspace at all.
   */
  reloadWorkspace: (cid: bigint) => Promise<void>;
  /** Leave for sign-in at `path`, telling the user why in `message`. */
  signInAgain: (path: string, message: string) => void;
}

export function reconnectingMessage(server: string): string {
  return `Reconnecting to ${server}…`;
}

/**
 * The agent's reason in the user's words, for the refusals it stops on at once; anything
 * else as the agent put it. Seen live: the toast read "(CID not registered to this node:
 * CID 1305… is not registered to this node)" for an account the server no longer had.
 */
function plainReason(reason: string | null): string | null {
  const text: string = reason?.trim() ?? '';
  if (text === '') return null;
  if (/is not registered to this node|account does not exist/i.test(text)) return 'the workspace no longer has this account';
  if (/invalid password/i.test(text)) return 'the password was not accepted';
  if (/is not claimable/i.test(text)) return 'the session ended while its link to the workspace was down';
  return text;
}

/**
 * A reconnect the workspace's verification check refused cannot come back by itself: the
 * agent cannot show the check. Say that, so the user knows the sign-in will ask for it.
 */
function admissionMessage(server: string, reasonCode: AdmissionReason): string {
  const why: string = reasonCode === 'admission_required'
    ? `${server} now asks for a verification check before you sign in`
    : `${server}'s verification check did not accept the reconnect`;
  return `${why}. Sign in again and complete the check to continue.`;
}

function signInMessage(server: string, reason: string | null, reasonCode: AdmissionReason | null): string {
  if (reasonCode !== null) return admissionMessage(server, reasonCode);
  const plain: string | null = plainReason(reason);
  const why: string = plain === null ? '' : ` (${plain})`;
  return `Couldn't reconnect to ${server}${why}. Sign in again to continue.`;
}

/** Where to send the user, and what to tell them, for a session that cannot come back. */
export interface SignInAfterLoss { path: string; message: string }

export function signInAfterLoss(username: string, server: string, reason: string | null, reasonCode: AdmissionReason | null): SignInAfterLoss {
  return { path: accountLinkPath({ username, server }), message: signInMessage(server, reason, reasonCode) };
}

export async function handleServerReconnectEvent(event: AgentReconnectEvent, io: ServerReconnectIO): Promise<void> {
  const own: OwnSession | null = await io.ownSession();
  if (!own || own.cid !== event.cid) return;

  if (event.kind === 'lost' && event.reconnecting) {
    io.setReconnecting(own.server);
    return;
  }

  io.setReconnecting(null);
  if (event.kind === 'reconnected') {
    // Side by side: neither waits on the other, and a failure of either reaches the caller.
    const settled: PromiseSettledResult<void>[] = await Promise.allSettled([io.reloadWorkspace(own.cid), io.resumePeers()]);
    for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason;
    return;
  }

  // Failed, or lost with the agent not retrying at all: either way this
  // session is gone and only signing in again brings it back.
  const reason: string | null = event.kind === 'failed' ? event.reason : null;
  const reasonCode: AdmissionReason | null = event.kind === 'failed' ? event.reasonCode : null;
  const signIn: SignInAfterLoss = signInAfterLoss(own.username, own.server, reason, reasonCode);
  io.signInAgain(signIn.path, signIn.message);
}
