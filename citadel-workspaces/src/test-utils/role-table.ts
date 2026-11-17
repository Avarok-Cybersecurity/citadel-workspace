/**
 * A role table as the server answers it, for tests: the seed every workspace starts with
 * (bindings/seed_roles.json, typed in), plus helpers to build variations. Input only; the code
 * under test reads it as it reads the server's.
 */
import type { Permission, RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';

export const OWNER_HOLDS: Permission[] = ['CreateNode', 'DeleteNode', 'UpdateNode', 'CreateWorkspace', 'UpdateWorkspace',
  'DeleteWorkspace', 'EditContent', 'AddUsers', 'RemoveUsers', 'EditMdx', 'EditNodeConfig', 'AddNode', 'UpdateNodeSettings', 'ViewContent',
  'ViewMembers', 'ManageNodeMembers', 'SendMessages', 'ReadMessages', 'UploadFiles', 'DownloadFiles', 'ManageDomains', 'EditWorkspaceConfig',
  'BanUser', 'EditTreeStructure', 'ManageNodeTypes', 'Themes', 'ViewTelemetry', 'ManageRoles'];

export const OWNER: RoleDefinition = { id: 'owner', name: 'Owner', permissions: OWNER_HOLDS, position: 65535, color: null };
export const ADMIN: RoleDefinition = { id: 'admin', name: 'Admin', permissions: ['All'], position: 300, color: null };
export const MEMBER: RoleDefinition = {
  id: 'member', name: 'Member', permissions: ['ViewContent', 'ViewMembers', 'SendMessages', 'ReadMessages', 'DownloadFiles'], position: 200, color: null,
};
export const GUEST: RoleDefinition = { id: 'guest', name: 'Guest', permissions: ['ViewContent', 'ViewMembers'], position: 100, color: null };

export const SEED: WorkspaceRoles = { roles: [OWNER, ADMIN, MEMBER, GUEST], default_role_id: 'member' };

/** A created role. */
export function role(id: string, position: number, permissions: Permission[], name: string = id): RoleDefinition {
  return { id, name, permissions, position, color: null };
}

/**
 * `roles`, ordered highest first as the server orders them. New members get Member, as in a
 * seeded workspace; a test about the default names it with `withDefault`.
 */
export function tableOf(...roles: RoleDefinition[]): WorkspaceRoles {
  return { roles: [...roles].sort((a: RoleDefinition, b: RoleDefinition): number => b.position - a.position), default_role_id: 'member' };
}

/** `table`, with new members given `roleId`. */
export function withDefault(table: WorkspaceRoles, roleId: string): WorkspaceRoles {
  return { ...table, default_role_id: roleId };
}
