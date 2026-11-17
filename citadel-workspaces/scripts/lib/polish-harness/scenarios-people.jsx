/**
 * Every view that shows a person, mounted with ONE roster in which Ada has a picture.
 * A scenario supplies input to the real components; it never replaces one.
 */
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountRow } from '@/components/AccountRows';
import { MemberListItem } from '@/pages/MemberListItem';
import { UserProfileCard } from '@/pages/UserProfileCard';
import NotificationItem from '@/components/notification/NotificationItem';
import { NotificationPriority, NotificationType } from '@/lib/notification-service/types';
import { MEMBERS_FILTER_SCENARIOS } from './scenarios-members-filter.jsx';

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d9822b"/><circle cx="32" cy="26" r="12" fill="#fff"/></svg>')}`;
export const ADA = { id: 'ada', username: 'ada', displayName: 'Ada Lovelace', role: 'member', isOnline: true, avatarUrl: PICTURE };
const STATE = {
  members: { ada: ADA },
  currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
};

const NOTHING = () => {};

/** Each view takes the picture from the roster by username, so each is expected to show Ada's. */
function People() {
  return (
    <WorkspaceProvider state={STATE}>
      <TooltipProvider>
        <div style={{ width: 360, padding: 16, display: 'grid', gap: 16 }}>
          <AccountRow username="ada" host="demo.example" current={false} live lastConnected={null} signedOut={null} onSwitch={NOTHING} onDelete={null} />
          <MemberListItem member={{ ...ADA, isSelf: false, isContact: false }} variant="all" onSendMessage={NOTHING} onInvite={NOTHING} onSelect={NOTHING} />
          <UserProfileCard selectedUser={ADA} isSelf={false} isConnected={false} onClose={NOTHING} onSendMessage={NOTHING} onInvite={NOTHING} />
          <NotificationItem notification={{ id: 'n1', type: NotificationType.MESSAGE, title: 'Ada sent a message', content: 'Hello', senderName: 'ada', priority: NotificationPriority.NORMAL, read: true, timestamp: Date.now() }} />
        </div>
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

export const PEOPLE_SCENARIOS = { people: People, ...MEMBERS_FILTER_SCENARIOS };
