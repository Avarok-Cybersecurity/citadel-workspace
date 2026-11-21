/**
 * The role table as if the server had answered, for tests that render role badges or icons.
 * Fed through the store's own request path, so the code under test reads it as it reads the
 * server's; pair with `resetRoles` after each test.
 */
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { getRolesState, requestRoles } from '@/lib/workspace-roles/roles-store';

export async function loadRoleTable(table: WorkspaceRoles): Promise<void> {
  requestRoles((): Promise<WorkspaceRoles> => Promise.resolve(table));
  await Promise.resolve();
  if (getRolesState().status !== 'loaded') throw new Error('the role table did not load');
}
