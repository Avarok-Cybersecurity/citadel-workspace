/**
 * The role-table requests resolve with the table the SERVER now holds, and an edit's answer is
 * ours only when it is about the role we edited: RoleChanged is broadcast to every member, and
 * the protocol carries no request id, so a colleague's edit of another role must not resolve
 * ours. Delete always names where the holders go.
 *
 * Doubled: the send (the wire) and the inbound event, as every write-gate test here does.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { createRole, deleteRole, listRoles, updateRole } from '../roles-operations';
import type { ProtocolSender } from '../workspace-operations';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, role, tableOf } from '@/test-utils/role-table';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequestTS[] };

function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      for (const response of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

const RENAMED: WorkspaceRoles = tableOf(OWNER, ADMIN, { ...MEMBER, name: 'Crew' }, GUEST);
const GUEST_EDITED: WorkspaceRoles = tableOf(OWNER, ADMIN, MEMBER, { ...GUEST, name: 'Visitors' });

describe('the role-table requests', () => {
  it('list: resolves with the table', async () => {
    const s: Sender = sender([{ Roles: { Roles: SEED } }]);
    expect(await listRoles(s)).toEqual(SEED);
    expect(s.sent).toEqual([{ Roles: 'List' }]);
  });

  it('update: takes the RoleChanged about OUR role, not a broadcast about another', async () => {
    const s: Sender = sender([
      { Roles: { RoleChanged: { role_id: 'guest', roles: GUEST_EDITED } } },
      { Roles: { RoleChanged: { role_id: 'member', roles: RENAMED } } },
    ]);
    expect(await updateRole(s, 'member', [{ Rename: 'Crew' }])).toEqual(RENAMED);
    expect(s.sent).toEqual([{ Roles: { Update: { id: 'member', changes: [{ Rename: 'Crew' }] } } }]);
  });

  it('create: takes the RoleChanged carrying a role by the name asked for', async () => {
    const made: WorkspaceRoles = tableOf(...SEED.roles, role('role-1', 150, ['ViewContent'], 'Reviewers'));
    const s: Sender = sender([
      { Roles: { RoleChanged: { role_id: 'guest', roles: GUEST_EDITED } } },
      { Roles: { RoleChanged: { role_id: 'role-1', roles: made } } },
    ]);
    expect(await createRole(s, { name: ' Reviewers ', permissions: ['ViewContent'], position: 150, color: null })).toEqual(made);
    expect(s.sent).toEqual([{ Roles: { Create: { name: 'Reviewers', permissions: ['ViewContent'], position: 150, color: null } } }]);
  });

  it('delete: sends where the holders go', async () => {
    const s: Sender = sender([{ Roles: { RoleChanged: { role_id: 'guest', roles: tableOf(OWNER, ADMIN, MEMBER) } } }]);
    await deleteRole(s, 'guest', 'member');
    expect(s.sent).toEqual([{ Roles: { Delete: { id: 'guest', reassign_to: 'member' } } }]);
  });

  it('rejects with the server\'s refusal, word for word', async () => {
    const s: Sender = sender([{ Error: 'Permission denied: ManageRoles required' }]);
    await expect(updateRole(s, 'member', [{ Rename: 'Crew' }])).rejects.toThrow('Permission denied: ManageRoles required');
  });
});
