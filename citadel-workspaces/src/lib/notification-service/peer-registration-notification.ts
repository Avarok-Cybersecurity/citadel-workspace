import { NotificationType, NotificationPriority , type Notification } from './types';
import { memberDisplayName } from '@/lib/member-names';

/**
 * The shape of a "someone wants to connect" notification.
 *
 * Separate from the service because it is the only notification carrying
 * action buttons, and those buttons hold live callbacks — accept and decline
 * both send on the wire. That makes this the one notification whose payload is
 * behaviour rather than text, which is worth being able to read in one place.
 */
/** The card's title, in one place for the card and for its rename below. */
export function requestTitle(name: string): string {
  return `${name} wants to connect`;
}

/**
 * The card named by the roster, or null when it already is (or the roster does
 * not know). A card built before the names loaded -- after a reload -- showed
 * the handle for good; this is what the service applies when names arrive.
 */
export function withRosterName(notification: Notification, nameOf: (username: string) => string | undefined): Notification | null {
  const username: unknown = notification.data?.peerUsername;
  if (notification.type !== NotificationType.PEER_REGISTRATION || typeof username !== 'string') return null;
  const name: string | undefined = nameOf(username);
  if (!name || name === notification.senderName) return null;
  return { ...notification, title: requestTitle(name), senderName: name };
}

export function peerRegistrationNotification(params: {
  peerUsername: string;
  peerCid: string;
  requestId: string;
  onAccept: () => void;
  onDecline: () => void;
  onCardClick: () => void;
  recipientCid?: string;
}): Omit<Notification, 'id' | 'timestamp' | 'read'> {
  // The roster's name where it knows one, as every other surface shows them.
  const name: string = memberDisplayName(params.peerUsername) ?? params.peerUsername;
  return {
    type: NotificationType.PEER_REGISTRATION,
    title: requestTitle(name),
    // The handle, not the CID: a truncated CID ("CID: 165819323455...") is
    // noise to the reader, who identifies people by name and handle.
    content: `@${params.peerUsername}`,
    senderId: params.peerCid,
    senderName: name,
    sourceId: params.requestId,
    recipientCid: params.recipientCid,
    priority: NotificationPriority.HIGH,
    actionButtons: [
      { id: 'accept', label: 'Accept', variant: 'default', onClick: params.onAccept },
      { id: 'decline', label: 'Decline', variant: 'destructive', onClick: params.onDecline },
    ],
    data: {
      requestId: params.requestId,
      peerCid: params.peerCid,
      peerUsername: params.peerUsername,
      onCardClick: params.onCardClick,
    },
  };
}
