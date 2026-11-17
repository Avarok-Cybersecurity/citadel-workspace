/**
 * This account's session ended somewhere else: another window signed it out
 * or deleted it.
 *
 * The agent tells every window attached to the account (a logout's other
 * windows get DisconnectNotification, a deletion's get DeregisterSuccess, each
 * without a request id). The window that asked hears the same thing as its own
 * answer, and is already on its way out; it marks the account while it asks,
 * so only the others say "in another window".
 */
import { isEndingHere } from './ending-here';

export type EndedReason = 'signed-out' | 'deleted';

export interface SessionEnded {
  cid: bigint;
  reason: EndedReason;
}

function inner(message: unknown, variant: string): Record<string, unknown> | undefined {
  const m: Record<string, unknown> = (message ?? {}) as Record<string, unknown>;
  const value: unknown = (m.Response as Record<string, unknown> | undefined)?.[variant] ?? m[variant];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** The session `message` says ended in another window, or null. */
export function endedElsewhere(message: unknown): SessionEnded | null {
  const out: Record<string, unknown> | undefined = inner(message, 'DisconnectNotification');
  // A peer's disconnect names the peer; the session's own does not.
  if (out && typeof out.cid === 'bigint' && (out.peer_cid === null || out.peer_cid === undefined)) {
    return isEndingHere(out.cid) ? null : { cid: out.cid, reason: 'signed-out' };
  }
  const gone: Record<string, unknown> | undefined = inner(message, 'DeregisterSuccess');
  if (gone && typeof gone.cid === 'bigint') {
    return isEndingHere(gone.cid) ? null : { cid: gone.cid, reason: 'deleted' };
  }
  return null;
}

export function endedMessage(username: string, reason: EndedReason): string {
  return reason === 'deleted'
    ? `${username} was deleted in another window.`
    : `${username} was signed out in another window.`;
}
