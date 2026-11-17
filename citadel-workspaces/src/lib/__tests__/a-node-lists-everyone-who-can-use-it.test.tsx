/**
 * A node's member list shows everyone with access, and marks who comes through a level above.
 *
 * Found live (2026-09-29): an office listed only the people added to it, while
 * workspace members used its chat through the level above. The server now lists
 * them and names the level (`inherited_from`); this is the client half.
 *
 * Real: the response handler, the event bus, the pure access rules, and the
 * sidebar row and admin row components. Nothing is mocked.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { handleGeneratedVariants } from '../workspace-response-handler/generated-variant-handlers';
import { eventEmitter } from '../event-emitter';
import type { MembersPayload } from '../workspace-events';
import { withAccess, levelName, blocksForMember, inheritedRemoveReason } from '../member-access';
import type { User as WorkspaceMember } from '@/types/workspace-entities';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MemberListItems } from '@/components/layout/sidebar/MemberListItems';
import { MemberRow } from '@/components/admin/tabs/MemberRow';
import type { MemberActionBlocks } from '@/components/layout/sidebar/member-actions-gate';

afterEach(cleanup);

const NONE: MemberActionBlocks = { managePermissions: null, changeRole: null, remove: null };
const member = (id: string, accessVia?: string): WorkspaceMember =>
  ({ id, username: id, displayName: id, isOnline: null, role: 'member', ...(accessVia ? { accessVia } : {}) }) as WorkspaceMember;

describe('the Members reply', () => {
  it('carries who came through a level above to the list', () => {
    const seen: MembersPayload[] = [];
    const off: () => void = eventEmitter.on('members:loaded', (p: MembersPayload): void => { seen.push(p); });
    handleGeneratedVariants({
      Members: { domain_id: 'office', members: [{ id: 'thomas', role: 'Admin', permissions: {}, metadata: {} }], inherited_from: { thomas: 'workspace-root' } },
    } as unknown as WorkspaceProtocolResponse, { cid: 0, request_id: 'r' });
    off();
    expect(seen.at(-1)?.inheritedFrom).toEqual({ thomas: 'workspace-root' });
  });

  it('reads a reply from an older server as all direct', () => {
    const seen: MembersPayload[] = [];
    const off: () => void = eventEmitter.on('members:loaded', (p: MembersPayload): void => { seen.push(p); });
    handleGeneratedVariants({
      Members: { domain_id: 'office', members: [{ id: 'thomas', role: 'Admin', permissions: {}, metadata: {} }] },
    } as unknown as WorkspaceProtocolResponse, { cid: 0, request_id: 'r' });
    off();
    expect(seen.at(-1)?.inheritedFrom).toEqual({});
  });
});

describe('the access rules', () => {
  it('marks only the people who come through a level above', () => {
    const marked: WorkspaceMember[] = withAccess([member('john'), member('thomas')], { thomas: 'workspace-root' });
    expect(marked.map((m) => m.accessVia)).toEqual([undefined, 'workspace-root']);
  });

  it('names a node by its name, and anything else by the workspace', () => {
    expect(levelName('office-1', { 'office-1': 'Ops' }, 'mac2')).toBe('Ops');
    expect(levelName('workspace-root', { 'office-1': 'Ops' }, 'mac2')).toBe('mac2');
  });

  it('blocks Remove for an inherited member, and keeps an existing refusal', () => {
    expect(blocksForMember(NONE, 'mac2').remove).toBe(inheritedRemoveReason('mac2'));
    expect(blocksForMember(NONE, null)).toBe(NONE);
    const refused: MemberActionBlocks = { ...NONE, remove: 'You do not have permission to remove members here.' };
    expect(blocksForMember(refused, 'mac2').remove).toBe(refused.remove);
  });
});

describe('a sidebar member row', () => {
  function rows(members: WorkspaceMember[]): void {
    render(
      <SidebarProvider><TooltipProvider>
        <MemberListItems members={members} blocks={NONE} nameOfLevel={(id: string): string => (id === 'workspace-root' ? 'mac2' : id)}
          currentUsername="me" onEditMember={() => undefined} openFilesOf={() => null} openChatWith={(): null => null} onRemoveMember={() => undefined}
          onManagePermissions={() => undefined} onShowAllMembers={() => undefined} />
      </TooltipProvider></SidebarProvider>,
    );
  }

  it('says where an inherited member comes from', () => {
    rows([member('john'), member('thomas', 'workspace-root')]);
    expect(screen.getAllByTestId('member-access-via').map((e) => e.textContent)).toEqual(['via mac2']);
  });

  it('offers Remove for a direct member and not for an inherited one', () => {
    rows([member('john'), member('thomas', 'workspace-root')]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for thomas' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: /remove member/i })).toHaveAttribute('data-disabled');
    expect(screen.getByText(inheritedRemoveReason('mac2'))).toBeInTheDocument();
    cleanup();
    rows([member('john'), member('thomas', 'workspace-root')]);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for john' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: /remove member/i })).not.toHaveAttribute('data-disabled');
  });
});

describe('an admin member row', () => {
  function row(accessViaName?: string): HTMLElement {
    render(
      <MemberRow member={{ userId: 'thomas', username: 'thomas', roleId: 'admin', isGuest: false, ...(accessViaName ? { accessViaName } : {}) }}
        showAdvanced={false} isUpdatingRole={false}
        rules={{ roles: [], assignable: new Set(), isOnlyManager: false, actOnBlocked: null }}
        onRoleChange={() => undefined} onAdvancedPermissions={() => undefined} onRemove={() => undefined} />,
    );
    return screen.getByTestId('member-remove-thomas');
  }

  it('cannot remove an inherited member, and says why', () => {
    const remove: HTMLElement = row('mac2');
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('aria-label', inheritedRemoveReason('mac2'));
    expect(screen.getByTestId('member-access-via-thomas')).toHaveTextContent('via mac2');
  });

  it('removes a direct member as before', () => {
    expect(row()).not.toBeDisabled();
  });
});
