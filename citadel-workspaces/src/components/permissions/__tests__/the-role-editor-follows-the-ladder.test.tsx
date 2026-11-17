/**
 * The role editor, as "Role permissions" in the sidebar opens it: what it lets each reader
 * change, what Save sends, and that it never says something saved before the server has.
 *
 * Real: the dialog, the editor, the grid, the role list, the ladder and the role-table store,
 * fed by the same event the response handler emits. Doubled: `rolesApi` (the one I/O boundary:
 * each call is a server round trip) and the toast sink, so what was said can be read back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleChange, RoleDefinition, RolesResponse, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { eventEmitter } from '@/lib/event-emitter';
import { resetRoles } from '@/lib/workspace-roles/roles-store';
import { PermissionManagerModal } from '../PermissionManagerModal';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, role, tableOf } from '@/test-utils/role-table';

interface ApiDouble {
  list: Mock<() => Promise<WorkspaceRoles>>;
  update: Mock<(id: string, changes: RoleChange[]) => Promise<WorkspaceRoles>>;
  remove: Mock<(id: string, reassignTo: string) => Promise<WorkspaceRoles>>;
  create: Mock<() => Promise<WorkspaceRoles>>;
}
const api: ApiDouble = vi.hoisted((): ApiDouble => ({
  list: vi.fn<() => Promise<WorkspaceRoles>>(),
  update: vi.fn<(id: string, changes: RoleChange[]) => Promise<WorkspaceRoles>>(),
  remove: vi.fn<(id: string, reassignTo: string) => Promise<WorkspaceRoles>>(),
  create: vi.fn<() => Promise<WorkspaceRoles>>(),
}));
vi.mock('@/lib/workspace-roles/roles-api', () => ({ rolesApi: api }));
const toast: Mock<(options: unknown) => void> = vi.hoisted((): Mock<(options: unknown) => void> => vi.fn<(options: unknown) => void>());
vi.mock('@/hooks/use-toast', () => ({ toast, useToast: (): { toast: typeof toast } => ({ toast }) }));

/** A created role between Admin and Member that may manage roles, holding little else. */
const LEAD: RoleDefinition = role('role-lead', 250, ['ManageRoles', 'ViewContent', 'ViewMembers', 'SendMessages'], 'Lead');
const WITH_LEAD: WorkspaceRoles = tableOf(OWNER, ADMIN, LEAD, MEMBER, GUEST);

type ContextValue = React.ContextType<typeof WorkspaceContext>;

function openAs(roleId: string): void {
  const value: ContextValue = { state: { nodes: {}, currentUser: { id: 'me', username: 'me', name: 'Me', roleId } } } as unknown as ContextValue;
  render(<WorkspaceContext.Provider value={value}><PermissionManagerModal isOpen onClose={() => undefined} /></WorkspaceContext.Provider>);
}
const announce = (answer: RolesResponse): void => { act(() => { eventEmitter.emit('workspace:roles', { answer }); }); };
const cell = (roleId: string, permission: string): HTMLElement => screen.getByTestId(`role-grant-${roleId}-${permission}`);
const isBox = (element: HTMLElement): boolean => element.getAttribute('role') === 'checkbox';

beforeAll((): void => {
  // jsdom lays nothing out; Radix Select scrolls its chosen item into view.
  Element.prototype.scrollIntoView = (): void => {};
});
beforeEach((): void => {
  resetRoles();
  api.list.mockReset().mockResolvedValue(SEED);
  api.update.mockReset();
  api.remove.mockReset();
  toast.mockClear();
});
afterEach(cleanup);

describe('the role editor', () => {
  it('says it is loading, never that there are no roles, until the table arrives', async () => {
    let answer: (table: WorkspaceRoles) => void = (): void => {};
    api.list.mockReturnValue(new Promise<WorkspaceRoles>((resolve: (t: WorkspaceRoles) => void): void => { answer = resolve; }));
    openAs('admin');
    expect(screen.getByTestId('roles-loading')).toHaveTextContent('Loading roles');
    expect(screen.queryByTestId('role-column-member')).toBeNull();
    await act(async (): Promise<void> => { answer(SEED); });
    expect(await screen.findByTestId('role-column-member')).toHaveTextContent('Member');
  });

  it('locks the Owner column, and the reader\'s own role, and opens the roles below', async () => {
    openAs('admin');
    await screen.findByTestId('role-column-member');
    expect(isBox(cell('owner', 'ManageRoles'))).toBe(false);
    expect(cell('owner', 'ManageRoles')).toHaveAttribute('data-role-grant', 'yes');
    expect(isBox(cell('admin', 'EditMdx'))).toBe(false);
    expect(isBox(cell('member', 'EditMdx'))).toBe(true);
    expect(isBox(cell('guest', 'ViewContent'))).toBe(true);
  });

  it('lets a reader tick only what they hold, and untick what the role has', async () => {
    api.list.mockResolvedValue(WITH_LEAD);
    openAs('role-lead');
    await screen.findByTestId('role-column-guest');
    expect(isBox(cell('guest', 'SendMessages'))).toBe(true);
    expect(isBox(cell('guest', 'EditMdx'))).toBe(false);
    expect(cell('guest', 'EditMdx')).toHaveAttribute('data-role-grant', 'no');
    expect(isBox(cell('member', 'DownloadFiles'))).toBe(true);
    expect(isBox(cell('admin', 'ViewContent'))).toBe(false);
  });

  it('is read-only for someone without Manage roles', async () => {
    openAs('member');
    await screen.findByTestId('role-column-member');
    expect(within(screen.getByRole('dialog')).queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByTestId('role-editor-save')).toBeNull();
  });

  it('saves exactly the edit, and says nothing saved until the server answers', async () => {
    let accept: (table: WorkspaceRoles) => void = (): void => {};
    api.update.mockReturnValue(new Promise<WorkspaceRoles>((resolve: (t: WorkspaceRoles) => void): void => { accept = resolve; }));
    openAs('admin');
    await screen.findByTestId('role-column-guest');
    await userEvent.click(cell('guest', 'SendMessages'));
    expect(screen.getByTestId('role-editor-pending')).toHaveTextContent('1 role changed');
    await userEvent.click(screen.getByTestId('role-editor-save'));

    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith('guest', [{ Grant: ['SendMessages'] }]);
    expect(toast).not.toHaveBeenCalled();

    const saved: WorkspaceRoles = tableOf(OWNER, ADMIN, MEMBER, { ...GUEST, permissions: [...GUEST.permissions, 'SendMessages'] });
    await act(async (): Promise<void> => {
      eventEmitter.emit('workspace:roles', { answer: { RoleChanged: { role_id: 'guest', roles: saved } } });
      accept(saved);
    });
    await waitFor((): void => { expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Roles saved' })); });
    expect(screen.queryByTestId('role-editor-pending')).toBeNull();
  });

  it('shows a refusal in the server\'s own words', async () => {
    api.update.mockRejectedValue(new Error('Permission denied: Admin does not hold ConfigureSystem and cannot grant it'));
    openAs('admin');
    await screen.findByTestId('role-column-guest');
    await userEvent.click(cell('guest', 'SendMessages'));
    await userEvent.click(screen.getByTestId('role-editor-save'));
    expect(await screen.findByTestId('role-editor-refusal')).toHaveTextContent('Permission denied: Admin does not hold ConfigureSystem and cannot grant it');
    // The edit is kept, so it can be corrected and sent again.
    expect(screen.getByTestId('role-editor-pending')).toHaveTextContent('1 role changed');
  });

  it('follows a colleague\'s change as the server announces it', async () => {
    openAs('admin');
    await screen.findByTestId('role-column-member');
    announce({ RoleChanged: { role_id: 'member', roles: tableOf(OWNER, ADMIN, { ...MEMBER, name: 'Crew' }, GUEST) } });
    expect(screen.getByTestId('role-column-member')).toHaveTextContent('Crew');
  });

  it('will not delete a role without being told where its holders go', async () => {
    api.remove.mockResolvedValue(tableOf(OWNER, ADMIN, MEMBER));
    openAs('admin');
    await screen.findByTestId('role-column-member');
    await userEvent.click(screen.getByTestId('role-tab-roles'));
    await userEvent.click(await screen.findByTestId('role-delete-guest'));

    const dialog: HTMLElement = await screen.findByRole('alertdialog');
    const confirm: HTMLElement = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByTestId('reassign-to'));
    const offered: string[] = screen.getAllByRole('option').map((o: HTMLElement): string => o.textContent ?? '');
    expect(offered).toEqual(['Member']);
    await userEvent.click(screen.getByRole('option', { name: 'Member' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(api.remove).toHaveBeenCalledWith('guest', 'member');
  });
});
