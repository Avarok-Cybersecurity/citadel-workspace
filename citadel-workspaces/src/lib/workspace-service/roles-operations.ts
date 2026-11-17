/**
 * The workspace role table on the workspace protocol.
 *
 * Every request is answered with `WorkspaceProtocolResponse::Roles`: a `List` with the table, an
 * edit with `RoleChanged`, which the server also broadcasts to every other member. Each call
 * resolves with the table the server now holds, and rejects with its refusal word for word. The
 * protocol has no request id, so an edit's answer is taken for ours only when it names the role
 * we edited (or, for a create, carries a role by the name we asked for).
 */
import type {
  Permission, RoleChange, RoleDefinition, RolesRequest, RolesResponse, WorkspaceRoles,
} from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

type RoleChanged = Extract<RolesResponse, { RoleChanged: unknown }>['RoleChanged'];

function listedOf(payload: unknown): WorkspaceRoles | null {
  if (!payload || typeof payload !== 'object' || !('Roles' in payload)) return null;
  return (payload as Extract<RolesResponse, { Roles: WorkspaceRoles }>).Roles;
}

function changedOf(payload: unknown): RoleChanged | null {
  if (!payload || typeof payload !== 'object' || !('RoleChanged' in payload)) return null;
  return (payload as Extract<RolesResponse, { RoleChanged: unknown }>).RoleChanged;
}

const aboutRole = (id: string) => (payload: unknown): WorkspaceRoles | null => {
  const changed: RoleChanged | null = changedOf(payload);
  return changed !== null && changed.role_id === id ? changed.roles : null;
};

async function exchange(
  sender: ProtocolSender,
  request: RolesRequest,
  read: (payload: unknown) => WorkspaceRoles | null,
): Promise<WorkspaceRoles> {
  let answered: WorkspaceRoles | null = null;
  await awaitWriteResponse('Roles', () => sender.sendProtocolRequest({ Roles: request }), (payload: unknown): boolean => {
    answered = read(payload);
    return answered !== null;
  });
  if (answered === null) throw new Error('Roles: the server\'s answer did not carry the role table');
  return answered;
}

export const listRoles = (s: ProtocolSender): Promise<WorkspaceRoles> => exchange(s, 'List', listedOf);

export interface NewRole {
  name: string;
  permissions: Permission[];
  position: number;
  color: string | null;
}

export const createRole = (s: ProtocolSender, role: NewRole): Promise<WorkspaceRoles> => {
  const name: string = role.name.trim().toLowerCase();
  return exchange(s, { Create: { ...role, name: role.name.trim() } }, (payload: unknown): WorkspaceRoles | null => {
    const changed: RoleChanged | null = changedOf(payload);
    if (changed === null) return null;
    const made: RoleDefinition | undefined = changed.roles.roles.find((r: RoleDefinition): boolean => r.id === changed.role_id);
    return made !== undefined && made.name.toLowerCase() === name ? changed.roles : null;
  });
};

export const updateRole = (s: ProtocolSender, id: string, changes: RoleChange[]): Promise<WorkspaceRoles> =>
  exchange(s, { Update: { id, changes } }, aboutRole(id));

/** `reassignTo` is required: the deleted role's holders move to it, and the server picks none. */
export const deleteRole = (s: ProtocolSender, id: string, reassignTo: string): Promise<WorkspaceRoles> =>
  exchange(s, { Delete: { id, reassign_to: reassignTo } }, aboutRole(id));
