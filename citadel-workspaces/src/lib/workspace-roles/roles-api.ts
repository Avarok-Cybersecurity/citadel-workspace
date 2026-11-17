/**
 * The role-table requests bound to this tab's workspace session. Components and hooks import this
 * rather than the sender-taking operations, so a test replaces the one I/O boundary.
 */
import WorkspaceService from '@/lib/workspace-service';
import * as ops from '@/lib/workspace-service/roles-operations';

/** An operation with its first argument, the session's sender, already supplied. */
type Bound<F> = F extends (sender: never, ...rest: infer A) => infer R ? (...args: A) => R : never;

export interface RolesApi {
  list: Bound<typeof ops.listRoles>;
  create: Bound<typeof ops.createRole>;
  update: Bound<typeof ops.updateRole>;
  remove: Bound<typeof ops.deleteRole>;
}

export const rolesApi: RolesApi = {
  list: () => ops.listRoles(WorkspaceService),
  create: (role: ops.NewRole) => ops.createRole(WorkspaceService, role),
  update: (id: string, changes: Parameters<typeof ops.updateRole>[2]) => ops.updateRole(WorkspaceService, id, changes),
  remove: (id: string, reassignTo: string) => ops.deleteRole(WorkspaceService, id, reassignTo),
};
