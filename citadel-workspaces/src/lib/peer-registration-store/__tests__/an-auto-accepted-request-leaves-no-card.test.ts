/**
 * A request that stops being pending must stop having a card.
 *
 * The store raises a notification per incoming registration request and nothing
 * took it back down. With auto-accept on, both consumers of one
 * `PeerRegisterNotification` run: this store records the request and raises the
 * card, while `p2p-registration-service` accepts it and calls
 * `removeRequestByPeerCid`, which removed the pending entry and left the card.
 *
 * The user was then left with an unread HIGH "X wants to connect" carrying live
 * Accept and Decline buttons for a request that had already been accepted — and
 * `removeNotification` is reachable only from the notification UI itself, so no
 * code path could clear it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearNotificationsFor } from '../notification-cleanup';
import { notificationService } from '@/lib/notification-service';
import { NotificationType } from '@/lib/notification-service/types';
import type { PendingPeerRequest } from '../types';

function request(id: string, peerCid: bigint): PendingPeerRequest {
  return {
    id,
    cid: 1n,
    peer_cid: peerCid,
    peer_username: `peer-${id}`,
    timestamp: 0,
  } as PendingPeerRequest;
}

/** Raise a card the way the store does, and hand back its notification id. */
function raiseCardFor(pending: PendingPeerRequest): string {
  return notificationService.addPeerRegistrationNotification(
    pending.peer_username,
    pending.peer_cid.toString(),
    pending.id,
    () => {},
    () => {},
    () => {},
    pending.cid.toString()
  ).id;
}

function liveCardIds(): string[] {
  return notificationService
    .getNotifications()
    .filter((n) => n.type === NotificationType.PEER_REGISTRATION)
    .map((n) => n.id);
}

beforeEach(() => {
  for (const id of notificationService.getNotifications().map((n) => n.id)) {
    notificationService.removeNotification(id);
  }
});

describe('a request that stops being pending', () => {
  it('has its card taken down', () => {
    const resolved: PendingPeerRequest = request('req-a', 111n);
    const card: string = raiseCardFor(resolved);
    expect(liveCardIds()).toContain(card);

    clearNotificationsFor([resolved], []);

    expect(liveCardIds()).not.toContain(card);
  });

  it('does not take down a card that is still pending', () => {
    // The scope. A sweep that cleared every peer-registration card would satisfy
    // the case above and lose a request the user still has to answer.
    const resolved: PendingPeerRequest = request('req-a', 111n);
    const untouched: PendingPeerRequest = request('req-b', 222n);
    const resolvedCard: string = raiseCardFor(resolved);
    const untouchedCard: string = raiseCardFor(untouched);

    clearNotificationsFor([resolved, untouched], [untouched]);

    expect(liveCardIds()).not.toContain(resolvedCard);
    expect(liveCardIds()).toContain(untouchedCard);
  });

  it('leaves a second request from the SAME peer alone', () => {
    // Keyed on the request id, not the peer's CID. Clearing by peer would take
    // down a genuinely pending request from someone who had just been accepted.
    const accepted: PendingPeerRequest = request('req-a', 111n);
    const alsoPending: PendingPeerRequest = request('req-b', 111n);
    const acceptedCard: string = raiseCardFor(accepted);
    const pendingCard: string = raiseCardFor(alsoPending);

    clearNotificationsFor([accepted, alsoPending], [alsoPending]);

    expect(liveCardIds()).not.toContain(acceptedCard);
    expect(liveCardIds()).toContain(pendingCard);
  });
});
