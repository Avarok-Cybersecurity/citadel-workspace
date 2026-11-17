/**
 * What the delete dialog says when the role going is the one new members get.
 *
 * The server makes the role its holders move to the new default, in the same write
 * (`role_edits::delete`), so the dialog names it before Delete is pressed rather than leaving
 * the reader to find out from the next person who joins.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { roleById } from './role-ladder';

/** The sentence for deleting `deleting` with its holders moving to `reassignTo`; null when it is not the default. */
export function deletingDefaultNotice(table: WorkspaceRoles, deleting: RoleDefinition, reassignTo: string): string | null {
  if (deleting.id !== table.default_role_id) return null;
  const next: RoleDefinition | null = roleById(table, reassignTo);
  const lead: string = `${deleting.name} is the role new members get.`;
  return next === null
    ? `${lead} The role you move its holders to becomes the role new members get.`
    : `${lead} After this, new members get ${next.name}.`;
}
