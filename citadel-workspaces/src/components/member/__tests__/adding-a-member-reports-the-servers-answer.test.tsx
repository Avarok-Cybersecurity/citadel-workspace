/**
 * Add member sends AddMember, reports the SERVER's answer, and refreshes.
 *
 * The modal existed with no way to open it; now that it is reachable, what it
 * does on submit is the product. The server (`add_user_to_domain`) answers
 * `Success("Member added successfully")` or `Error("Failed to add member: …")`,
 * and only the first may close the dialog or say "Member Added".
 *
 * Driven for real from the form down to the frame: the modal, the service's
 * `addMember`, `awaitWriteResponse` and the event bus. The doubles are the
 * wire (a sender that records the request and plays the server's answer back
 * on `workspace:raw-response`, as the response handler does), the toast sink,
 * and the role table's one I/O call (`rolesApi.list`), which answers with the
 * seed table -- the ladder that decides what is offered runs for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { resetRoles } from '@/lib/workspace-roles/roles-store';
import { registerDocumentSync } from '@/lib/document-sync-requests';

const { toast, sent, answer, caller, roster, listed } = vi.hoisted(() => ({
  listed: [] as string[],
  toast: vi.fn(),
  sent: [] as unknown[],
  answer: { current: {} as Record<string, unknown> },
  // The caller's role id, as their own member record left it in the context.
  caller: { roleId: 'admin' as string },
  // The root roster ListMembers answers with.
  roster: { current: [] as Array<{ id: string; username: string; roleId: string }> },
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: typeof toast } => ({ toast }) }));
vi.mock('@/lib/workspace-roles/roles-api', async () => {
  const { SEED } = await import('@/test-utils/role-table');
  return { rolesApi: { list: async (): Promise<WorkspaceRoles> => SEED } };
});
vi.mock('@/lib/workspace-service', async () => {
  const members: typeof import('@/lib/workspace-service/member-operations') =
    await import('@/lib/workspace-service/member-operations');
  const { eventEmitter } = await import('@/lib/event-emitter');
  const sender: import('@/lib/workspace-service/workspace-operations').ProtocolSender = {
    currentCid: 1n,
    sendProtocolRequest: async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      queueMicrotask((): void => { eventEmitter.emit('workspace:raw-response', answer.current); });
    },
  };
  return {
    default: {
      listMembers: async (domainId: string): Promise<void> => {
        listed.push(domainId);
        queueMicrotask((): void => {
          eventEmitter.emit('members:loaded', { members: roster.current, domainId });
        });
      },
      addMember: (userId: string, role: import('citadel-workspace-client-ts').MemberRole, domainId?: string): Promise<void> =>
        members.addMember(sender, userId, role, domainId),
    },
  };
});

import { MemberManagementModal } from '../MemberManagementModal';
import { eventEmitter } from '@/lib/event-emitter';
import { NO_ADD_USERS } from '@/components/layout/sidebar/add-member-gate';

const reloads: unknown[] = [];
eventEmitter.on('members:reload', (payload: unknown): void => { reloads.push(payload); });

type ContextValue = React.ContextType<typeof WorkspaceContext>;

function openAdd(onClose: () => void, domainId?: string): void {
  const value: ContextValue = { state: { nodes: {}, currentUser: { id: 'me', username: 'me', name: 'Me', roleId: caller.roleId } } } as unknown as ContextValue;
  render(
    <WorkspaceContext.Provider value={value}>
      <MemberManagementModal isOpen onClose={onClose} mode="add" domainId={domainId} />
    </WorkspaceContext.Provider>,
  );
}

/** Picks `roleId` in the role select, through the native select Radix mirrors it into. */
async function pickRole(roleId: string): Promise<void> {
  await waitFor((): void => { expect(offeredRoles()).toContain(roleId); });
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: roleId } });
}

async function submitAdd(username: string, onClose: () => void, domainId?: string): Promise<void> {
  openAdd(onClose, domainId);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  await pickRole('member');
  fireEvent.click(screen.getByTestId('entity-modal-submit'));
}

function toastTitles(): string[] {
  return toast.mock.calls.map((call: unknown[]): string => (call[0] as { title: string }).title);
}

beforeEach((): void => {
  sent.length = 0;
  reloads.length = 0;
  toast.mockClear();
  caller.roleId = 'admin';
  roster.current = [];
  listed.length = 0;
  resetRoles();
});

/** The roles the dialog's select carries, read from the native select Radix mirrors them into. */
function offeredRoles(): string[] {
  return Array.from(document.querySelectorAll('select option'))
    .map((option: Element): string => (option as HTMLOptionElement).value)
    .filter((value: string): boolean => value !== '')
    // Radix appends an option as each item registers, so order is not the menu's.
    .sort();
}

describe('adding a member', () => {
  it('sends AddMember for the username and domain the form names', async () => {
    answer.current = { Success: 'Member added successfully' };
    await submitAdd('bob', vi.fn(), 'office-1');

    await waitFor((): void => { expect(sent).toHaveLength(1); });
    expect(sent[0]).toEqual({ AddMember: { user_id: 'bob', domain_id: 'office-1', role: 'member', metadata: undefined } });
  });

  it('closes, says so and refreshes the roster only once the server accepts', async () => {
    answer.current = { Success: 'Member added successfully' };
    const onClose: ReturnType<typeof vi.fn> = vi.fn();
    await submitAdd('bob', onClose);

    await waitFor((): void => { expect(onClose).toHaveBeenCalled(); });
    expect(toastTitles()).toEqual(['Member Added']);
    expect(reloads).toHaveLength(1);
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    answer.current = { Error: "Failed to add member: No account named 'bobb' exists on this workspace" };
    const onClose: ReturnType<typeof vi.fn> = vi.fn();
    await submitAdd('bobb', onClose);

    const shown: HTMLElement = await screen.findByTestId('entity-modal-error');
    expect(shown).toHaveTextContent("No account named 'bobb' exists on this workspace");
    expect(shown).not.toHaveTextContent('Failed to add member');
    expect(onClose).not.toHaveBeenCalled();
    expect(toastTitles()).not.toContain('Member Added');
    // A refused write changed nothing, so there is nothing to reload.
    expect(reloads).toHaveLength(0);
  });

  it('sends the edits this device holds of the place once the server accepts', async () => {
    const asked: string[] = [];
    const close: () => void = registerDocumentSync({ nodeId: 'doc-7', chatDoc: null }, (): Promise<void> => { asked.push('doc-7'); return Promise.resolve(); });
    answer.current = { Success: 'Member added successfully' };
    const onClose: ReturnType<typeof vi.fn> = vi.fn();
    await submitAdd('bob', onClose, 'doc-7');
    await waitFor((): void => { expect(onClose).toHaveBeenCalled(); });
    expect(asked).toEqual(['doc-7']);
    close();
  });

  it('sends nothing of the place when the server refuses', async () => {
    const asked: string[] = [];
    const close: () => void = registerDocumentSync({ nodeId: 'doc-8', chatDoc: null }, (): Promise<void> => { asked.push('doc-8'); return Promise.resolve(); });
    answer.current = { Error: "Failed to add member: No account named 'bobb' exists on this workspace" };
    await submitAdd('bobb', vi.fn(), 'doc-8');
    await screen.findByTestId('entity-modal-error');
    expect(asked).toEqual([]);
    close();
  });

  it('says a permission refusal in plain words, not the permission name', async () => {
    answer.current = { Error: 'Failed to add member: Permission denied: AddUsers is required to manage members' };
    await submitAdd('bob', vi.fn());

    const shown: HTMLElement = await screen.findByTestId('entity-modal-error');
    expect(shown).toHaveTextContent(NO_ADD_USERS);
    expect(shown).not.toHaveTextContent(/Permission denied|AddUsers/);
  });
});

describe('the role list', () => {
  it('sends nothing until a role is chosen: there is no default role', async () => {
    answer.current = { Success: 'Member added successfully' };
    openAdd(vi.fn());
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    await waitFor((): void => { expect(offeredRoles()).toContain('member'); });
    fireEvent.click(screen.getByTestId('entity-modal-submit'));
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    expect(sent).toHaveLength(0);
  });

  it('does not offer an Admin the Owner seat someone already holds, nor their own rank', async () => {
    roster.current = [{ id: 'olga', username: 'olga', roleId: 'owner' }];
    openAdd(vi.fn());

    await waitFor((): void => { expect(listed).toContain('workspace-root'); });
    await waitFor((): void => { expect(offeredRoles()).toEqual(['guest', 'member']); });
  });

  it('offers an Admin a vacant Owner seat, which the server lets them fill', async () => {
    roster.current = [{ id: 'ada', username: 'ada', roleId: 'admin' }];
    openAdd(vi.fn());

    await waitFor((): void => { expect(offeredRoles()).toEqual(['guest', 'member', 'owner']); });
  });

  it('does not offer a Member the vacant Owner seat, only what is below them and within their grants', async () => {
    caller.roleId = 'member';
    roster.current = [{ id: 'ada', username: 'ada', roleId: 'admin' }, { id: 'alice', username: 'alice', roleId: 'member' }];
    openAdd(vi.fn());

    // Wait for the roster, so a pass is not the unknown-roster answer.
    await waitFor((): void => { expect(listed).toContain('workspace-root'); });
    await waitFor((): void => { expect(offeredRoles()).toEqual(['guest']); });
  });

  it('offers an Owner every role', async () => {
    caller.roleId = 'owner';
    roster.current = [{ id: 'olga', username: 'olga', roleId: 'owner' }];
    openAdd(vi.fn());

    await waitFor((): void => { expect(offeredRoles()).toEqual(['admin', 'guest', 'member', 'owner']); });
  });
});
