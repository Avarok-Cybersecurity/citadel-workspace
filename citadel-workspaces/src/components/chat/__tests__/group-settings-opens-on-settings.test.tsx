/**
 * The header menu's "Group Settings" must open the settings, not the roster.
 *
 * Both of the menu's panel items -- "Group Settings" and "View Members" --
 * called the same `onOpenSettings()`, and the panel opened on its default tab,
 * Members. So "Group Settings" showed the member list, and the settings were
 * one more click away behind a tab the user had no reason to look for.
 *
 * Header and panel are rendered for real and joined the way GroupChatPage
 * joins them. The only replaced edge is the connection read, which is how
 * `useGroupPermissions` learns who "self" is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { GroupChatHeader } from '../GroupChatHeader';
import { GroupSettingsPanel } from '../GroupSettingsPanel';
import { connectionManager } from '@/lib/connection';
import { DEFAULT_MEMBER_PERMISSIONS, type GroupPermissions } from '@/types/group-permissions';
import type { GroupSettingsTab } from '../group-settings-types';
import type { GroupConversation } from '@/types/group';

const SELF: bigint = 7n;
const OWNER: bigint = 99n;

function groupWhereSelfHas(permissions: GroupPermissions): GroupConversation {
  return {
    id: '99:1',
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

function HeaderAndPanel({ group }: { group: GroupConversation }): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [tab, setTab] = useState<GroupSettingsTab>('members');
  const noop: () => Promise<void> = async (): Promise<void> => {};
  return (
    <>
      <GroupChatHeader
        group={group}
        onOpenSettings={(next: GroupSettingsTab): void => { setTab(next); setOpen(true); }}
        onLeaveGroup={noop}
      />
      <GroupSettingsPanel
        open={open}
        onOpenChange={setOpen}
        tab={tab}
        onTabChange={setTab}
        group={group}
        onNameChange={noop}
        onSettingsChange={(): void => {}}
        onMemberRoleChange={noop}
        onKickMember={noop}
        onDeleteGroup={noop}
      />
    </>
  );
}

async function choose(item: string, permissions: GroupPermissions): Promise<string> {
  render(<HeaderAndPanel group={groupWhereSelfHas(permissions)} />);
  await userEvent.click(screen.getByRole('button', { name: 'Group settings' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
  return screen.getByRole('tab', { selected: true }).textContent ?? '';
}

beforeEach(() => {
  vi.spyOn(connectionManager, 'getConnectionInfo').mockReturnValue({ cid: SELF, username: 'self' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the group header menu', () => {
  const EVERYTHING: GroupPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, editGroupSettings: true, manageRoles: true };

  it('"Group Settings" opens the Settings tab', async () => {
    expect(await choose('Group Settings', EVERYTHING)).toBe('Settings');
  });

  it('"Group Settings" opens Roles for a member who may manage roles but not settings', async () => {
    // Settings is not a tab this member has; Roles is what grants them the item.
    const rolesOnly: GroupPermissions = { ...DEFAULT_MEMBER_PERMISSIONS, editGroupSettings: false, manageRoles: true };
    expect(await choose('Group Settings', rolesOnly)).toBe('Roles');
  });

  it('"View Members" still opens Members', async () => {
    // The control: a menu that sent everything to Settings would pass the two
    // tests above and fail this one.
    expect(await choose('View Members', EVERYTHING)).toBe('Members');
  });
});
