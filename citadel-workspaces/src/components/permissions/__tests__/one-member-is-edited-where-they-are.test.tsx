/**
 * "Manage Permissions" on one member opened the workspace-wide role matrix: four
 * role columns, no sign of who was being edited or where. These pin the view
 * that replaced it, through the real dialog, hook, path rule and diff. The one
 * stand-in is the workspace service — the wire — whose answers arrive the way
 * the server's do, on the event emitter.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getUserPermissions: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const updateMemberPermissions: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/workspace-service', () => ({
  default: {
    getUserPermissions: (...args: unknown[]): unknown => getUserPermissions(...args),
    updateMemberPermissions: (...args: unknown[]): unknown => updateMemberPermissions(...args),
  },
}));

const { eventEmitter } = await import('@/lib/event-emitter');
const { setTreeSchema } = await import('@/lib/entity-type-registry');
const { WORKSPACE_ROOT_ID } = await import('@/lib/workspace-constants');
const { WorkspaceProvider } = await import('@/contexts/WorkspaceContext');
const { MemberPermissionsDialog } = await import('../MemberPermissionsDialog');
import type { WorkspaceState } from '@/contexts/WorkspaceContext';
import { registerDocumentSync } from '@/lib/document-sync-requests';
import type { DomainNode, TreeSchema } from '@/components/layout/sidebar/tree-node-types';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

const config = (type: string, label: string): TreeSchema['entity_type_configs'][number] => ({
  type_name: type, icon: 'folder', label, plural_label: `${label}s`, name_placeholder: '', description_placeholder: '',
});

function node(id: string, parent: string, type: string, name: string): DomainNode {
  return {
    id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '',
    members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false,
    chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'], metadata: [],
    allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
  };
}

const ADA: WorkspaceMember = { id: 'ada', username: 'ada', displayName: 'Ada Lovelace', isOnline: true } as WorkspaceMember;
const STATE: WorkspaceState = {
  workspace: { id: WORKSPACE_ROOT_ID, name: 'Acme' },
  members: { ada: ADA },
  nodes: { hq: node('hq', WORKSPACE_ROOT_ID, 'Office', 'HQ'), standup: node('standup', 'hq', 'Room', 'Standup') },
  nodesUnavailable: false, membershipRefused: false, treeSchema: null,
  loading: { workspace: false, members: false, nodes: false },
  messages: { byPeer: {} }, typing: { peerIds: [], lastUpdated: 0 },
} as WorkspaceState;

function answer(domainId: string, permissions: string[]): void {
  act(() => { eventEmitter.emit('user:permissions:loaded', { userId: 'ada', domainId, role: 'Member', permissions }); });
}

function answerEveryLevel(): void {
  answer(WORKSPACE_ROOT_ID, ['ViewContent']);
  answer('hq', ['ViewContent', 'SendMessages']);
  answer('standup', ['ViewContent', 'SendMessages', 'UploadFiles']);
}

const onClose: ReturnType<typeof vi.fn> = vi.fn();
const open = (): void => {
  render(<WorkspaceProvider state={STATE}><MemberPermissionsDialog open onClose={onClose} member={ADA} domainId="standup" /></WorkspaceProvider>);
};
// By permission id, not by its words: labels are copy and change.
const box = (id: string): HTMLElement => within(screen.getByTestId(`member-permission-row-${id}`)).getByRole('checkbox');

beforeAll(() => {
  // Renamed levels: nothing may say "Office" or "Room".
  setTreeSchema({ entity_type_configs: [config('Workspace', 'Company'), config('Office', 'Studio'), config('Room', 'Booth')] } as unknown as TreeSchema);
});

beforeEach(() => {
  getUserPermissions.mockClear();
  updateMemberPermissions.mockClear();
  onClose.mockClear();
});

describe('one member’s permissions', () => {
  it('is titled with the person, and asks the server about every level on the way down', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace’s permissions' })).toBeInTheDocument();
    expect(getUserPermissions.mock.calls.map((call: unknown[]) => call[1]).sort()).toEqual(['hq', 'standup', WORKSPACE_ROOT_ID].sort());
    expect(getUserPermissions.mock.calls.every((call: unknown[]) => call[0] === 'ada')).toBe(true);
  });

  it('names the path with the schema’s level names and marks the level being edited', () => {
    open();
    const path: HTMLElement = screen.getByRole('list', { name: 'Where these permissions apply' });
    expect(within(path).getAllByRole('listitem').map((li: HTMLElement) => li.textContent)).toEqual(['Company Acme', 'Studio HQ', 'Booth Standup']);
    expect(within(path).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'location');
    expect(screen.queryByText(/Office|Room/)).toBeNull();
  });

  it('shows nothing it cannot vouch for, and refuses Save, until every level has answered', () => {
    open();
    answer('standup', ['ViewContent']);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Ada Lovelace’s permissions');
    expect(screen.getByTestId('member-permissions-save')).toBeDisabled();
  });

  it('locks a grant from a level above and says which level to change it at', async () => {
    open();
    answerEveryLevel();
    await waitFor(() => expect(box('ViewContent')).toBeChecked());
    expect(box('ViewContent')).toBeDisabled();
    expect(screen.getByTestId('member-permission-row-ViewContent')).toHaveTextContent('From Company Acme — change it there');
    expect(screen.getByTestId('member-permission-row-SendMessages')).toHaveTextContent('From Studio HQ — change it there');
    expect(box('UploadFiles')).toBeEnabled();
    expect(screen.getByTestId('member-permission-row-UploadFiles')).toHaveTextContent('Granted here');
    // Named by its own label and described by where it comes from, not left as an anonymous box.
    expect(box('UploadFiles')).toHaveAccessibleName('Upload Files');
    expect(box('SendMessages')).toHaveAccessibleDescription(/From Studio HQ/);
  });

  it('says what Save will change, for whom and where, and sends exactly that to this level', async () => {
    open();
    answerEveryLevel();
    await waitFor(() => expect(box('UploadFiles')).toBeEnabled());
    expect(screen.getByTestId('member-permissions-save')).toBeDisabled();

    await userEvent.click(box('UploadFiles'));
    await userEvent.click(box('DeleteNode'));
    expect(screen.getByTestId('member-permission-row-UploadFiles')).toHaveTextContent('Will be removed');
    expect(screen.getByTestId('member-permission-row-DeleteNode')).toHaveTextContent('Will be granted');
    expect(screen.getByTestId('member-permissions-summary')).toHaveTextContent('2 changes for Ada Lovelace in Booth Standup.');

    await userEvent.click(screen.getByTestId('member-permissions-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateMemberPermissions.mock.calls).toEqual([
      ['ada', 'standup', ['DeleteNode'], 'Add'],
      ['ada', 'standup', ['UploadFiles'], 'Remove'],
    ]);
  });

  async function saveAfterClicking(id: string): Promise<string[]> {
    const asked: string[] = [];
    const close: () => void = registerDocumentSync({ nodeId: 'standup', chatDoc: null }, (): Promise<void> => { asked.push('standup'); return Promise.resolve(); });
    open();
    answerEveryLevel();
    await waitFor(() => expect(box(id)).toBeEnabled());
    await userEvent.click(box(id));
    await userEvent.click(screen.getByTestId('member-permissions-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    close();
    return asked;
  }

  it('sends the edits this device holds of the level when Save grants something there', async () => {
    expect(await saveAfterClicking('DeleteNode')).toEqual(['standup']);
  });

  it('sends nothing when Save only removes', async () => {
    expect(await saveAfterClicking('UploadFiles')).toEqual([]);
  });

  it('does not let a click on a locked grant become an edit', async () => {
    open();
    answerEveryLevel();
    await waitFor(() => expect(box('ViewContent')).toBeDisabled());
    await userEvent.click(box('ViewContent'));
    expect(screen.getByTestId('member-permissions-summary')).toHaveTextContent('No changes yet.');
  });
});

describe('focus', () => {
  it('lands on the dialog, which is named by the person, so who and where are announced first', async () => {
    open();
    const dialog: HTMLElement = screen.getByRole('dialog', { name: 'Ada Lovelace’s permissions' });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAccessibleDescription(/Changes apply to Ada Lovelace in Booth Standup/);
  });
});
