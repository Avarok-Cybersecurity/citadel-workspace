/**
 * What each gate looks at. A scenario supplies INPUT to a real component; it never replaces one.
 */
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider, SidebarMenu } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '@/components/layout/sidebar/MemberListItems';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { ChatDropTarget } from '@/components/p2p/ChatDropTarget';
import { dropUnavailableReason } from '@/components/p2p/drop-unavailable';
import { P2PChat } from '@/components/p2p/P2PChat';
import { MessageList } from '@/components/chat/pane/MessageList';
import { authored } from '@/lib/chat/transport/peer-history';
import { NODE_CHAT_SCENARIOS } from './scenarios-node-chat.jsx';
import { PEOPLE_SCENARIOS } from './scenarios-people.jsx';
import { OVERLAY_SCENARIOS } from './scenarios-overlays.jsx';
import { SPACING_SCENARIOS } from './scenarios-spacing.jsx';
import { SCREEN_SCENARIOS } from './scenarios-screens.jsx';
import { SIDEBAR_SCENARIOS } from './scenarios-sidebar.jsx';
import { PERMISSION_SCENARIOS } from './scenarios-permissions.jsx';
import { FILE_MANAGER_SCENARIOS } from './scenarios-file-manager.jsx';
import { SHARE_SCENARIOS } from './scenarios-share.jsx';
import { RIBBON_SCENARIOS } from './scenarios-ribbons.jsx';
import { MIGRATION_SCENARIOS } from './scenarios-migration.jsx';
import { APP_TOOLBAR_SCENARIOS } from './scenarios-app-toolbar.jsx';
import { PEER_CONSENT_SCENARIOS } from './scenarios-peer-consent.jsx';
import { CHAT_FILE_SCENARIOS } from './scenarios-chat-files.jsx';
import { ACCOUNT_SWITCH_SCENARIOS } from './scenarios-account-switch.jsx';
import { SERVER_FILE_SCENARIOS } from './scenarios-server-files.jsx';
import { NODE_TAB_SCENARIOS } from './scenarios-node-tabs.jsx';
import { CALENDAR_SCENARIOS } from './scenarios-calendar.jsx';
import { CALENDAR_CHANGE_SCENARIOS } from './scenarios-calendar-changes.jsx';
import { CALENDAR_TEAM_SCENARIOS } from './scenarios-calendar-teams.jsx';

const person = (username, role, title) => ({
  id: username, username, displayName: username[0].toUpperCase() + username.slice(1), role, title, isOnline: true,
});

const OPEN_NOTHING = () => null;
const NOOP = () => {};

function SidebarMembers() {
  const members = [person('alice', 'owner', 'CEO'), person('bob', 'admin', 'CTO'), person('carol', 'member', 'Designer'), person('dave', 'member')];
  return (
    <SidebarProvider>
      <TooltipProvider delayDuration={0}>
        <div style={{ width: 256, padding: 16 }}>
          <SidebarMenu>
            <MemberListItems
              members={members}
              blocks={{ managePermissions: null, changeRole: null, remove: null }}
              nameOfLevel={(id) => id}
              currentUsername="dave"
              openChatWith={OPEN_NOTHING}
              openFilesOf={OPEN_NOTHING}
              onEditMember={NOOP}
              onRemoveMember={NOOP}
              onManagePermissions={NOOP}
              onShowAllMembers={NOOP}
            />
          </SidebarMenu>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}

const ME = 1n;
const PEER = 2n;
const NOON = new Date().setHours(12, 0, 0, 0);

const message = (index, from, extra) => ({
  id: `m${index}`, content: `Message number ${index}`, senderCid: from, recipientCid: from === ME ? PEER : ME,
  timestamp: NOON + index * 60_000, index, status: 'delivered', message_type: 'text', ...extra,
});

/** A live-document bubble with a plain message under it, and a message that carries reactions. */
function P2PConversation() {
  const messages = [
    message(0, PEER),
    message(1, ME, { message_type: 'live_document', document_id: 'doc-1', document_title: 'Launch plan' }),
    message(2, PEER),
    message(3, ME, { reactions: [{ emoji: '👍', reactorCid: PEER, at: 1, active: true }, { emoji: '🎉', reactorCid: PEER, at: 2, active: true }] }),
    message(4, PEER),
    message(5, ME),
  ].map((m) => authored(m, { cid: ME, username: 'me', displayName: 'Me' }, { cid: PEER, name: 'Ada', username: 'ada' }));
  const nothing = () => {};
  return (
    <TooltipProvider>
      <div style={{ height: 640, display: 'flex', flexDirection: 'column' }}>
        <MessageList
          messages={messages} greeting="Say hello to Ada." namesSenders={false} selfCid={ME}
          reactorName={(cid) => (cid === ME ? 'You' : 'Ada')}
          isLoadingMore={false} isLoadingHistory={false} hasMorePages={false}
          onScroll={nothing} onRetryMessage={nothing} onOpenDocument={nothing}
          onAcceptTransfer={nothing} onDeclineTransfer={nothing} onCancelTransfer={nothing} onOpenFile={nothing}
          onEditMessage={nothing} onDeleteMessage={nothing} onReplyMessage={nothing}
          focusComposer={nothing} onReactMessage={nothing} awaitingAcceptFrom={null}
        />
      </div>
    </TooltipProvider>
  );
}

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d9822b"/><circle cx="32" cy="26" r="12" fill="#fff"/></svg>')}`;
const WORKSPACE_WITH_ADA = {
  members: { ada: { id: 'ada', username: 'ada', displayName: 'Ada Lovelace', role: 'member', isOnline: true, avatarUrl: PICTURE } },
  currentUser: { id: 'me', username: 'me', name: 'Me' },
  nodes: {}, treeSchema: null, loading: { workspace: false, members: false, nodes: false },
};

/**
 * The whole conversation, unmodified; there is no agent behind it, so the link reads as down.
 * Inside a router, as in the app: the header's files button navigates to the file manager.
 */
function WholeChat() {
  return (
    <div style={{ height: '100vh' }}>
      <MemoryRouter initialEntries={['/workspace']}>
        <WorkspaceProvider state={WORKSPACE_WITH_ADA}>
          <ConfirmDialogProvider><TooltipProvider>
            <P2PChat peerCid={PEER} peerName="Ada Lovelace" peerUsername="ada" currentUserCid={ME} currentUserName="Me" />
          </TooltipProvider></ConfirmDialogProvider>
        </WorkspaceProvider>
      </MemoryRouter>
    </div>
  );
}

/** The drop target where a document is open: the real target and the real reason, with a stand-in body. */
function DropUnavailable({ state }) {
  return (
    <div style={{ height: '100vh' }}>
      <ChatDropTarget className="h-full bg-background" testId="p2p-chat" peerName="Ada Lovelace" onFile={() => {}} unavailable={dropUnavailableReason(state)}>
        <p style={{ padding: 16 }}>The conversation behind the overlay.</p>
      </ChatDropTarget>
    </div>
  );
}

export const SCENARIOS = { 'document-open': () => <DropUnavailable state={{ carriesFiles: true, viewingDocument: true, paused: false }} />, 'paused-drag': () => <DropUnavailable state={{ carriesFiles: true, viewingDocument: false, paused: true }} />, 'p2p-chat': WholeChat, 'sidebar-members': SidebarMembers, 'p2p-conversation': P2PConversation, ...PEOPLE_SCENARIOS, ...OVERLAY_SCENARIOS, ...SPACING_SCENARIOS, ...SCREEN_SCENARIOS, ...SIDEBAR_SCENARIOS, ...PERMISSION_SCENARIOS, ...FILE_MANAGER_SCENARIOS, ...SHARE_SCENARIOS, ...RIBBON_SCENARIOS, ...MIGRATION_SCENARIOS, ...APP_TOOLBAR_SCENARIOS, ...PEER_CONSENT_SCENARIOS, ...NODE_TAB_SCENARIOS, ...CALENDAR_SCENARIOS, ...CALENDAR_CHANGE_SCENARIOS, ...CALENDAR_TEAM_SCENARIOS, ...NODE_CHAT_SCENARIOS, ...SERVER_FILE_SCENARIOS, ...CHAT_FILE_SCENARIOS, ...ACCOUNT_SWITCH_SCENARIOS };
