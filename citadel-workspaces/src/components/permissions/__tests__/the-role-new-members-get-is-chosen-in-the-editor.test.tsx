/**
 * "New members get": choosing it, seeing it marked in the role list, and the delete dialog
 * saying when the role going is it and what takes its place.
 *
 * Real: the dialog, the editor, the role list, the ladder and the role-table store, fed by the
 * event the response handler emits. Doubled: `rolesApi` (the one I/O boundary: each call is a
 * server round trip) and the toast sink.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleChange, RolesResponse, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { eventEmitter } from '@/lib/event-emitter';
import { resetRoles } from '@/lib/workspace-roles/roles-store';
import { PermissionManagerModal } from '../PermissionManagerModal';
import { SEED, withDefault } from '@/test-utils/role-table';

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

type ContextValue = React.ContextType<typeof WorkspaceContext>;

async function openRolesAs(roleId: string): Promise<void> {
  const value: ContextValue = { state: { nodes: {}, currentUser: { id: 'me', username: 'me', name: 'Me', roleId } } } as unknown as ContextValue;
  render(<WorkspaceContext.Provider value={value}><PermissionManagerModal isOpen onClose={() => undefined} /></WorkspaceContext.Provider>);
  await screen.findByTestId('role-column-member');
  await userEvent.click(screen.getByTestId('role-tab-roles'));
}
const announce = (answer: RolesResponse): void => { act(() => { eventEmitter.emit('workspace:roles', { answer }); }); };
const options = (): string[] => screen.getAllByRole('option').map((o: HTMLElement): string => o.textContent ?? '');

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

describe('the role new members get', () => {
  it('is marked in the role list, and only on that role', async () => {
    await openRolesAs('admin');
    expect(screen.getByTestId('role-default-member')).toHaveTextContent('New members get this role');
    expect(screen.queryByTestId('role-default-guest')).toBeNull();
  });

  it('is chosen by an admin among the roles they could assign, and moves when the server says so', async () => {
    const guestDefault: WorkspaceRoles = withDefault(SEED, 'guest');
    api.update.mockResolvedValue(guestDefault);
    await openRolesAs('admin');
    await userEvent.click(screen.getByTestId('default-role-picker'));
    expect(options()).toEqual(['Member', 'Guest']);
    await userEvent.click(screen.getByRole('option', { name: 'Guest' }));
    expect(api.update).toHaveBeenCalledWith('guest', ['MakeDefault']);

    // Not before the server's RoleChanged: the list still marks Member.
    expect(screen.getByTestId('role-default-member')).toBeInTheDocument();
    announce({ RoleChanged: { role_id: 'guest', roles: guestDefault } });
    expect(screen.getByTestId('role-default-guest')).toBeInTheDocument();
    expect(screen.queryByTestId('role-default-member')).toBeNull();
  });

  it('is read, not chosen, by someone who may not manage roles', async () => {
    await openRolesAs('member');
    expect(screen.getByTestId('default-role')).toHaveTextContent('New members get: Member');
    expect(screen.queryByTestId('default-role-picker')).toBeNull();
  });

  it('is named in the delete dialog, with the role that takes its place', async () => {
    await openRolesAs('owner');
    await userEvent.click(screen.getByTestId('role-delete-member'));
    const dialog: HTMLElement = await screen.findByRole('alertdialog');
    expect(within(dialog).getByTestId('delete-default-notice')).toHaveTextContent('Member is the role new members get.');

    await userEvent.click(within(dialog).getByTestId('reassign-to'));
    expect(options()).not.toContain('Owner');
    await userEvent.click(screen.getByRole('option', { name: 'Guest' }));
    expect(within(screen.getByRole('alertdialog')).getByTestId('delete-default-notice')).toHaveTextContent('After this, new members get Guest.');
  });

  it('is not mentioned when deleting another role, whose holders may go to the Owner', async () => {
    await openRolesAs('owner');
    await userEvent.click(screen.getByTestId('role-delete-guest'));
    const dialog: HTMLElement = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByTestId('delete-default-notice')).toBeNull();
    await userEvent.click(within(dialog).getByTestId('reassign-to'));
    expect(options()).toContain('Owner');
  });
});
