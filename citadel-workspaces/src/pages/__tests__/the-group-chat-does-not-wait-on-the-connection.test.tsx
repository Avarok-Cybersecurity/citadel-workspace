/**
 * A tab that could not name its own connection got no group chat at all.
 *
 * `GroupChatPage` rendered its chat area behind `{currentUserId && groupId &&
 * ...}`, and `currentUserId` comes from `connectionManager.getConnectionInfo()`
 * — the CONNECTION's identity, not the tab's. With two sessions in one browser
 * that lookup is empty or belongs to the other tab, so the second user got a
 * group page with no message list and no composer. Two integration jobs report
 * it identically and with the same asymmetry: user one always sends, user two
 * never can.
 *
 * The old chat view's own prop comment said `currentUserId` was "Unused by the
 * view itself; kept only for callers that still pass it". The entire chat was
 * gated on a value its consumer ignores.
 *
 * What it IS needed for is deciding who to leave out of a call invite, and
 * guessing there rings the caller in their own call — so the call controls
 * still wait for it while the chat does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { GroupConversation } from '@/types/group';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/types/group-permissions';

const connection: { current: { cid: bigint; username: string } | null } = { current: null };

const group: GroupConversation = {
  id: 'g1',
  name: 'Design',
  ownerId: 99n,
  members: [
    { cid: 99n, username: 'alice', roleId: 'r', joinedAt: 1 },
    { cid: 7n, username: 'bob', roleId: 'r', joinedAt: 2 },
  ],
  settings: {
    defaultRoleId: 'r',
    roles: [{ id: 'r', name: 'Member', color: '#fff', position: 1, isBuiltIn: true, permissions: DEFAULT_MEMBER_PERMISSIONS }],
  },
} as unknown as GroupConversation;

vi.mock('react-router-dom', () => ({
  useParams: (): { groupId: string } => ({ groupId: 'g1' }),
  useNavigate: (): (() => void) => (): void => {},
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): unknown => connection.current,
    getTabSelectedSession: async (): Promise<unknown> => null,
  },
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedUsername: string }> => ({ selectedUsername: 'bob' }),
}));
vi.mock('@/hooks/use-group-conversations', () => ({
  useGroupConversations: (): unknown => ({
    getGroup: (): GroupConversation => group,
    hydrated: true,
    markAsRead: (): void => {},
    leaveGroup: async (): Promise<void> => {},
    kickMember: async (): Promise<void> => {},
    updateMemberRole: async (): Promise<void> => {},
    invitePeer: async (): Promise<void> => {},
  }),
}));
vi.mock('@/hooks/use-registered-peers', () => ({ useRegisteredPeers: (): unknown => ({ registeredPeers: [] }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): unknown => ({ toast: (): void => {} }) }));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }): JSX.Element => <div>{children}</div>,
  default: ({ children }: { children: React.ReactNode }): JSX.Element => <div>{children}</div>,
}));
vi.mock('@/components/chat/GroupChatHeader', () => ({
  GroupChatHeader: ({ callControls }: { callControls: React.ReactNode }): JSX.Element => <div>{callControls}</div>,
}));
vi.mock('@/components/call/GroupCallControls', () => ({
  GroupCallControls: (): JSX.Element => <div data-testid="call-controls" />,
}));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/components/chat/GroupSettingsPanel', () => ({ GroupSettingsPanel: (): JSX.Element => <div /> }));
// The page decides whether the chat renders and whom it names; the chat itself is tested in
// a-peer-group-chats-like-a-direct-chat.
vi.mock('@/components/chat/PeerGroupChat', () => ({
  PeerGroupChat: (props: { readerName: string }): JSX.Element => (
    <div data-testid="group-message-input" data-name={props.readerName} />
  ),
}));

const { GroupChatPage } = await import('../GroupChatPage');

describe('the group chat page', () => {
  beforeEach((): void => { connection.current = null; });

  it('renders the chat when this tab cannot name its connection', async () => {
    // The exact state of the second tab in a two-session browser.
    render(<GroupChatPage />);
    await waitFor((): void => {
      expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    });
  });

  it('names the reader from the tab when the connection cannot', async () => {
    // Not 'You', which is what it used to fall back to.
    render(<GroupChatPage />);
    await waitFor((): void => {
      expect(screen.getByTestId('group-message-input').getAttribute('data-name')).toBe('bob');
    });
  });

  it('renders the chat when it can name the connection, too', async () => {
    // The positive control: without it, "renders when unknown" would pass on a
    // page that renders the composer unconditionally and knows nothing.
    connection.current = { cid: 7n, username: 'bob' };
    render(<GroupChatPage />);
    await waitFor((): void => {
      expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    });
  });

  it('withholds the call controls until it knows who not to ring', async () => {
    render(<GroupChatPage />);
    await waitFor((): void => {
      expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    });
    expect(screen.queryByTestId('call-controls')).toBeNull();
  });

  it('offers the call controls once it does', async () => {
    connection.current = { cid: 7n, username: 'bob' };
    render(<GroupChatPage />);
    await waitFor((): void => {
      expect(screen.queryByTestId('call-controls')).toBeTruthy();
    });
  });
});
