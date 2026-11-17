import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance';
import NotificationService from '@/lib/notification-service';
import { debugLog } from '@/lib/debug-config';
import { isOwnGroupMessage } from './own-message';
import { groupInFront } from './group-in-front';

/**
 * Raise a bell notification for an incoming group message.
 *
 * Group chat produced no notification of any kind. `addMessageNotification` had
 * exactly two callers — the P2P manager and a dev-only simulator — so the whole
 * group pipeline updated the sidebar badge and stopped. No bell entry, no OS
 * notification, no sound; the backgrounded-tab path was unreachable for groups
 * entirely. Someone working in another window learned of group traffic only by
 * happening to look at the sidebar.
 *
 * The three rules below are all borrowed from the P2P path rather than invented,
 * because two notification surfaces that disagree about when to interrupt are
 * worse than one that is slightly wrong.
 */
let started: boolean = false;

/** Idempotent, like the store's own bindings: the first consumer arms it. */
/** `selfUsername` reads the signed-in account's username; see startGroupEventBindings. */
export function startGroupNotificationBindings(selfUsername: () => string | undefined): void {
  if (started) return;
  started = true;

  eventEmitter.on('group:message-received', (data: {
    groupId: string;
    senderId: string;
    senderName?: string;
    content: string;
    selfUsername?: string;
  }) => {
    const own: bigint | null = instanceManager.cid;

    // 1. Never for your own message. The server answers the SENDER with the
    //    same notification it broadcasts to everyone else -- that echo is what
    //    confirms a send -- so without this every message you sent would ring
    //    your own bell. By CID or username: an office channel names the sender
    //    by username (see own-message).
    if (isOwnGroupMessage(data.senderId, { cid: own, username: data.selfUsername ?? selfUsername() })) return;

    // 2. Never for the conversation the user is reading right now: a peer group
    //    by its URL, an office/room chat by the channel its view marked open --
    //    in a window that is in front, the rule every surface shares (in-front.ts).
    if (groupInFront(data.groupId)) return;

    debugLog('GroupNotifications', 'raising notification for group', data.groupId);
    NotificationService.getInstance().addMessageNotification(
      data.senderName || 'New group message',
      data.content,
      data.senderId,
      // 3. Keyed by group and content, not by a random id: a redelivered
      //    message must not stack a second identical bell entry.
      `group:${data.groupId}:${data.senderId}:${data.content}`,
      own === null ? undefined : String(own),
      { groupId: data.groupId },
    );
  });
}
