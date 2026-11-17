import { BROADCAST_MESSAGE_TYPES } from '@/lib/multi-instance/routing-rules';

/**
 * Does a notification belong to the session this tab is using?
 *
 * One browser holds ONE WebSocket, shared by every tab and every logged-in
 * account. The router does its best to deliver each notification to the tab
 * that owns its `cid`, but it has three documented paths that deliberately
 * deliver elsewhere: the 2s orphan buffer (the owner is mid-reload or
 * mid-ClaimSession), the un-acked forward fallback, and a stale instance
 * registry. On all three, a notification addressed to session B is handed to a
 * tab running as A.
 *
 * That is fine as long as the receiving handler checks. Where it does not, the
 * consequences are not cosmetic:
 *
 *   - a `GroupInviteNotification` for B, auto-accepted by A, makes A send
 *     `GroupRespondRequest{response: true}` under ITS OWN cid — account A joins
 *     a group it was never invited to, and B never sees the invitation;
 *   - a `PeerRegisterNotification` for B, auto-accepted by A, makes A register
 *     P2P with the stranger who asked for B.
 *
 * The check already existed, correctly, in
 * `p2p-auto-connect-service/incoming-connect.ts`, and had not been propagated
 * to its siblings. One implementation now, so the next handler that needs it
 * cannot get it subtly different.
 */

/**
 * `false` unless both sides are known AND equal.
 *
 * Refusing when the tab has no session is deliberate and is not merely a
 * defensive default: the leader tab is very often the landing/connect page,
 * which has no cid, and treating "I am nobody" as "everything is mine" is how
 * a tab logged into no account came to process another account's messages.
 */
export function isForThisSession(
  notificationCid: bigint | null | undefined,
  currentCid: bigint | null | undefined,
): boolean {
  if (notificationCid === null || notificationCid === undefined) return false;
  if (currentCid === null || currentCid === undefined) return false;
  // A zero cid is the "no session" sentinel elsewhere in this codebase, not a
  // real account, so it must not match anything — including itself.
  if (notificationCid === 0n || currentCid === 0n) return false;
  return notificationCid === currentCid;
}

export function messageVariant(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const keys: string[] = Object.keys(data as Record<string, unknown>);
  return keys.length === 1 ? keys[0] : null;
}

/**
 * Which session a broadcast message is addressed to, or null if it is not
 * addressed to one.
 *
 * Null means "forward it": plenty of traffic legitimately names no session --
 * the request/response messages a follower proxies through the leader, for one
 * -- and dropping those would silence the follower entirely.
 *
 * `BROADCAST_MESSAGE_TYPES` are also treated as unaddressed even when they
 * carry a cid. Those are deliberate fan-out: every tab needs to know about a
 * disconnect or a deregistration, and filtering them by cid would undo that on
 * purpose-built behaviour.
 */
export function notificationCid(data: unknown): bigint | null {
  const variant: string | null = messageVariant(data);
  if (variant === null || BROADCAST_MESSAGE_TYPES.includes(variant)) return null;

  const payload: unknown = (data as Record<string, unknown>)[variant];
  if (!payload || typeof payload !== 'object') return null;

  const cid: unknown = (payload as Record<string, unknown>).cid;
  if (typeof cid === 'bigint') return cid;
  // The wire carries u64 as a string in some paths; a cid that does not parse
  // names nobody, and guessing is how a message reaches the wrong session.
  if (typeof cid === 'string' && /^\d+$/.test(cid)) return BigInt(cid);
  return null;
}
