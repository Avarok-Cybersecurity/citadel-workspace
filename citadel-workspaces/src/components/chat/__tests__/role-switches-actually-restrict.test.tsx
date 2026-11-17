/**
 * A permission switch that governs nothing is worse than no switch.
 *
 * `GroupPermissions` has eight keys, the role editor renders a labelled switch
 * for every one, and `formatPermissions` summarises them on the role list. Two
 * of the eight were read by nothing:
 *
 *   - `sendMessages` -- the only group composer's caller hardcoded
 *     `canSendMessages={true}`, so a "Muted" role sent messages anyway.
 *   - `viewMemberList` -- the chat header, the settings roster and the sidebar
 *     row all rendered the membership unconditionally.
 *
 * Group roles are entirely client-side state, so there is no server behind them
 * to enforce what the client declines to. The role's own settings page stated a
 * restriction that was not true.
 *
 * Each test carries its positive control: the permitted role must show the
 * thing, or "hidden when denied" would pass on a component that renders nothing
 * either way.
 *
 * Wiring them up then exposed a second problem of the same shape one level up.
 * `useGroupPermissions` answers false both for a role that denies and for a
 * user who is not in the member list at all -- and `buildGroupFromInvite` adds
 * the accepting user on a best-effort basis, so the second happens for real.
 * Those users were told "Your role in this group cannot send messages", naming
 * a role they do not have. An absence rendered as a decision, which is the same
 * mistake as the presence dot one directory over. Hence the third answer, and
 * the last two tests here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import type { GroupConversation } from '@/types/group';
import type { GroupPermissions } from '@/types/group-permissions';
import { DEFAULT_MEMBER_PERMISSIONS } from '@/types/group-permissions';
import { groupRestriction, type GroupRestriction } from '../group-restriction';
import { GroupChatHeader } from '../GroupChatHeader';
import { GroupMemberManagement } from '../GroupMemberManagement';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { ChatPane } from '../pane/ChatPane';
import { fakeTransport } from '@/lib/chat/transport/__tests__/doubles/fake-transport';

const SELF: bigint = 7n;
const OWNER: bigint = 99n;

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): { cid: bigint; username: string } => ({ cid: SELF, username: 'self' }),
  },
}));

/**
 * The group's chat pane with the reader's restriction as its send gate. The pane is the real one
 * over a recording transport: what is under test is that the restriction reaches the composer.
 */
function composer(restriction: GroupRestriction): JSX.Element {
  const { transport } = fakeTransport({
    kind: 'peer-group', self: { cid: SELF, username: 'self', displayName: 'self' }, counterpart: 'Design',
    latest: { messages: [], older: null },
    stated: { markdown: false, readReceipts: false, securityLevel: false, retention: false, optimistic: false, namesSenders: true },
    ports: { status: false, files: true, documents: false, settings: false, revise: false, reactions: true },
    sendGate: restriction, recordsOnSend: true,
  });
  return <ConfirmDialogProvider><ChatPane transport={transport} pause={null} header={(): null => null} /></ConfirmDialogProvider>;
}

vi.mock('react-router-dom', () => ({
  useNavigate: (): (() => void) => (): void => {},
}));

/**
 * A group in which the current user holds a role with exactly `permissions`.
 * The owner is somebody else, because `isOwner` short-circuits to every
 * permission and would mask whatever the role says.
 */
function groupWhereSelfHas(permissions: GroupPermissions): GroupConversation {
  return {
    id: 'g1',
    name: 'Design',
    ownerId: OWNER,
    members: [
      { cid: OWNER, username: 'owner', roleId: 'owner-role', joinedAt: 1 },
      { cid: SELF, username: 'self', roleId: 'member-role', joinedAt: 2 },
    ],
    settings: {
      defaultRoleId: 'member-role',
      roles: [
        { id: 'owner-role', name: 'Owner', color: '#fff', position: 10, isBuiltIn: true, permissions: DEFAULT_MEMBER_PERMISSIONS },
        { id: 'member-role', name: 'Member', color: '#fff', position: 1, isBuiltIn: true, permissions },
      ],
    },
  } as unknown as GroupConversation;
}

const MUTED: GroupPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, sendMessages: false };
const BLINDED: GroupPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, viewMemberList: false };

describe('the viewMemberList switch', () => {
  it('hides the roster in the chat header, and shows it when permitted', async () => {

    const permitted: ReturnType<typeof render> = render(
      <GroupChatHeader
        group={groupWhereSelfHas(DEFAULT_MEMBER_PERMISSIONS)}
        onOpenSettings={(): void => {}}
        onLeaveGroup={async (): Promise<void> => {}}
      />,
    );
    // Positive control: without this, "not shown when denied" is trivially true.
    expect(permitted.container.textContent).toContain('2 members');
    permitted.unmount();

    const denied: ReturnType<typeof render> = render(
      <GroupChatHeader
        group={groupWhereSelfHas(BLINDED)}
        onOpenSettings={(): void => {}}
        onLeaveGroup={async (): Promise<void> => {}}
      />,
    );
    expect(denied.container.textContent).not.toContain('2 members');
  });

  it('replaces the settings roster with the reason', async () => {

    const permitted: ReturnType<typeof render> = render(
      <GroupMemberManagement
        group={groupWhereSelfHas(DEFAULT_MEMBER_PERMISSIONS)}
        onRoleChange={async (): Promise<void> => {}}
        onKickMember={async (): Promise<void> => {}}
      />,
    );
    expect(permitted.container.textContent).toContain('Members (2)');
    permitted.unmount();

    render(<GroupMemberManagement
        group={groupWhereSelfHas(BLINDED)}
        onRoleChange={async (): Promise<void> => {}}
        onKickMember={async (): Promise<void> => {}}
      />);
    // Told why, not shown an empty list -- a blank roster reads as "no members".
    expect(screen.getByTestId('group-members-restricted')).toBeTruthy();
  });
});

describe('the sendMessages switch', () => {
  it('replaces the composer with the reason, and leaves it alone when permitted', async () => {

    // Driven from the role itself rather than a literal, so this covers the
    // whole chain the defect broke: role -> can('sendMessages') -> composer.
    const allowed: boolean = renderHook(() =>
      useGroupPermissions(groupWhereSelfHas(DEFAULT_MEMBER_PERMISSIONS)),
    ).result.current.can('sendMessages');
    const muted: boolean = renderHook(() =>
      useGroupPermissions(groupWhereSelfHas(MUTED)),
    ).result.current.can('sendMessages');
    expect(allowed).toBe(true);
    expect(muted).toBe(false);

    const allowedRestriction: GroupRestriction = groupRestriction(true, true, allowed);
    const mutedRestriction: GroupRestriction = groupRestriction(true, true, muted);
    expect(mutedRestriction).toBe('denied-by-role');

    const permitted: ReturnType<typeof render> = render(composer(allowedRestriction));
    expect(screen.queryByTestId('group-message-input')).toBeTruthy();
    expect(screen.queryByTestId('group-send-restricted')).toBeNull();
    permitted.unmount();

    render(composer(mutedRestriction));
    expect(screen.queryByTestId('group-message-input')).toBeNull();
    expect(screen.getByTestId('group-send-restricted')).toBeTruthy();
  });
});

describe('a user who is not in the member list', () => {
  /** What `buildGroupFromInvite` produces when it cannot resolve self. */
  function groupWithoutSelf(): GroupConversation {
    const full: GroupConversation = groupWhereSelfHas(DEFAULT_MEMBER_PERMISSIONS);
    return { ...full, members: full.members.filter((m) => m.cid === OWNER) };
  }

  it('is told that, not that their role forbids it', async () => {

    const result: ReturnType<typeof useGroupPermissions> = renderHook(() =>
      useGroupPermissions(groupWithoutSelf()),
    ).result.current;

    // The two states the old boolean squeezed into one.
    expect(result.listedAsMember).toBe(false);
    expect(result.can('sendMessages')).toBe(false);
    const restriction: GroupRestriction = groupRestriction(
      result.listedAsMember,
      result.myRole !== undefined,
      result.can('sendMessages'),
    );
    expect(restriction).toBe('not-listed');

    render(composer(restriction));
    const said: string = screen.getByTestId('group-send-restricted').textContent ?? '';
    expect(said).toContain('not listed as a member');
    // The specific wrong thing it used to say.
    expect(said).not.toContain('permission');
  });

  it('sees the same distinction on the member list', async () => {

    render(
      <GroupMemberManagement
        group={groupWithoutSelf()}
        onRoleChange={async (): Promise<void> => {}}
        onKickMember={async (): Promise<void> => {}}
      />,
    );
    expect(screen.getByTestId('group-members-restricted').textContent ?? '').toContain(
      'not listed as a member',
    );
  });
});

describe('a member whose roleId names no role we have', () => {
  /**
   * Role ids are minted per peer with `crypto.randomUUID()`, so an id carried
   * over from another peer's copy of the group resolves against nothing here.
   * The member is listed; the role is simply not findable.
   */
  function groupWithDanglingRole(): GroupConversation {
    const full: GroupConversation = groupWhereSelfHas(DEFAULT_MEMBER_PERMISSIONS);
    return {
      ...full,
      members: full.members.map((m) =>
        m.cid === SELF ? { ...m, roleId: 'a-role-id-from-another-peer' } : m,
      ),
    };
  }

  it('is told the role is missing, not that they lack permission', async () => {

    const result: ReturnType<typeof useGroupPermissions> = renderHook(() =>
      useGroupPermissions(groupWithDanglingRole()),
    ).result.current;

    // Listed, but with nothing to resolve -- the pair the old two-argument
    // call could not tell apart from a role that says no.
    expect(result.listedAsMember).toBe(true);
    expect(result.myRole).toBeUndefined();
    expect(result.can('sendMessages')).toBe(false);

    const restriction: GroupRestriction = groupRestriction(
      result.listedAsMember,
      result.myRole !== undefined,
      result.can('sendMessages'),
    );
    expect(restriction).toBe('role-missing');

    render(composer(restriction));
    const said: string = screen.getByTestId('group-send-restricted').textContent ?? '';
    expect(said).toContain('role in this group could not be found');
    // The specific wrong thing it used to say: a refusal attributed to a role
    // that does not exist.
    expect(said).not.toContain('do not have permission');
  });

  it('still says denied-by-role when the role exists and refuses', () => {
    // Positive control: the new branch must not swallow real refusals.
    expect(groupRestriction(true, true, false)).toBe('denied-by-role');
    // ...and must not fire when the action is permitted.
    expect(groupRestriction(true, false, true)).toBe('allowed');
    // Not listed outranks a missing role: there is no role to miss.
    expect(groupRestriction(false, false, false)).toBe('not-listed');
  });
});
