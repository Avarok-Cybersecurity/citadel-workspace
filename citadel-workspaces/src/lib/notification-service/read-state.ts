import { NotificationType, notificationBelongsTo , type Notification } from './types';

/**
 * Which notifications a "mark read" applies to.
 *
 * Extracted as predicates rather than left as three near-identical loops, so
 * the scope of each sweep is legible at a glance — the defect this addresses
 * was a per-session panel calling the everything-everywhere sweep, and the two
 * were indistinguishable at the call site.
 */
export type ReadPredicate = (notification: Notification) => boolean;

/** Everything, in every session. Almost never what a caller wants. */
export const everything: ReadPredicate = () => true;

/**
 * Only what the given session can see.
 *
 * Deliberately `notificationBelongsTo` — the same predicate the panel filters
 * with — so "what was shown" and "what was marked read" cannot disagree.
 */
export function belongingTo(cid: string | null): ReadPredicate {
  return (notification) => notificationBelongsTo(notification, cid);
}

/** Message notifications from one sender, whatever session they belong to. */
export function messagesFrom(senderId: string): ReadPredicate {
  return (notification) =>
    notification.type === NotificationType.MESSAGE && notification.senderId === senderId;
}

/** Message notifications raised for one group or node channel (group-notifications sets `groupId`). */
export function messagesInGroup(groupId: string): ReadPredicate {
  return (notification) =>
    notification.type === NotificationType.MESSAGE && notification.data?.groupId === groupId;
}
