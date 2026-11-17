import { conversationInFront } from '@/lib/notification-service/in-front';
import { isChannelOpen } from './open-channel';

/**
 * Whether the user is looking at this group right now.
 *
 * A peer group is read at `/groups/:id`; an office/room chat marks its channel
 * open (see open-channel). Both count only in a window that is in front. The
 * bell and the sidebar's unread badge ask here, so they cannot disagree about
 * what "reading" means.
 */
export function groupInFront(groupId: string): boolean {
  const onItsRoute: boolean =
    typeof window !== 'undefined' && window.location.pathname.includes(`/groups/${groupId}`);
  return conversationInFront(onItsRoute || isChannelOpen(groupId));
}
