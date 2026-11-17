/**
 * The toast for a message that arrived while you were looking elsewhere.
 *
 * Split out of `message-handler-routing.ts` to keep it under the length cap.
 *
 * The click was dead twice over. This site supplied the callback as `onOpen`,
 * while `NotificationItem` reads `data.onCardClick`, so the key never matched;
 * and the callback emitted `p2p:open-conversation`, which nothing listened for.
 * Either alone was enough, so fixing one would have looked like no change.
 *
 * A third, smaller thing was wrong beside them: the card showed a pointer
 * cursor only for `type === PEER_REGISTRATION`, so even once the click worked
 * the reader had no sign it would.
 * The peer's name comes from `lib/peer-display` rather than being assembled
 * here: this site used to build `Peer <first 8 CID digits>` of its own, which
 * is the exact rendering that module exists to abolish, and which disagreed
 * with the two other hand-rolled variants elsewhere in the app.
 * When the conversation does not know the username, the name comes from the
 * roster (`roster-peer-name`), as it does for calls and group messages.
 */
import { isPlaceholderName, peerDisplayName } from '@/lib/peer-display';
import { rosterPeerName } from '@/lib/roster-peer-name';
import { eventEmitter } from '../event-emitter';
import type { MessageHandlerConfig } from './message-handler-types';
import type { P2PMessage, P2PConversation } from './p2p-types';

/** How much of the message body the toast shows. */
const PREVIEW_LENGTH: number = 100;

/** What the toast needs from the messenger. */
export type ArrivalNotice = Pick<MessageHandlerConfig, 'shouldShowNotification' | 'getConversations' | 'addNotification'>;

export function notifyMessageArrived(
  config: ArrivalNotice,
  peerCid: bigint,
  message: P2PMessage,
  recipientCid?: bigint,
): void {
  if (!config.shouldShowNotification(peerCid)) return;

  const conversation: P2PConversation | undefined = config.getConversations().get(peerCid);
  const known: string | undefined = conversation?.peerUsername;
  // A conversation opened by an inbound message has no username yet, which
  // titled the toast "New message from Peer D7U2E0" beside a sidebar row
  // reading "Thomas Braun". The roster is where that name lives.
  const peerUsername: string = isPlaceholderName(known) ? rosterPeerName(peerCid) : peerDisplayName({ cid: peerCid, username: known });

  config.addNotification(
    `New message from ${peerUsername}`,
    message.content.substring(0, PREVIEW_LENGTH),
    peerCid.toString(),
    message.id,
    recipientCid?.toString(),
    {
      peerCid: peerCid.toString(),
      // `onCardClick` is the key NotificationItem reads. It was `onOpen` here.
      onCardClick: (): void => {
        // bigint on the wire between the two halves; the decimal string
        // appears only where the URL is built.
        eventEmitter.emit('p2p:open-conversation', { peerCid, peerUsername });
      },
    },
  );
}
