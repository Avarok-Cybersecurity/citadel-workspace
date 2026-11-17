/**
 * What Save sends: the difference between what the SERVER grants and what the
 * editor now shows, for one member at one level. Both editors save through
 * this, so neither can drift back to diffing against client-side defaults.
 */
import WorkspaceService from '@/lib/workspace-service';
import type { PermissionTS, UpdateOperationTS } from '@/types/workspace-protocol';

export interface PermissionChanges {
  added: string[];
  removed: string[];
}

/** The grants to add and to remove to turn `server` into `edited`. */
export function permissionChanges(server: ReadonlySet<string>, edited: ReadonlySet<string>): PermissionChanges {
  return {
    added: [...edited].filter((p: string): boolean => !server.has(p)),
    removed: [...server].filter((p: string): boolean => !edited.has(p)),
  };
}

export const changeCount = (changes: PermissionChanges): number => changes.added.length + changes.removed.length;

/** Sends `changes` for `userId` at `domainId`; nothing at all when there are none. */
export async function applyPermissionChanges(userId: string, domainId: string, changes: PermissionChanges): Promise<void> {
  if (changes.added.length > 0) {
    await WorkspaceService.updateMemberPermissions(userId, domainId, changes.added as PermissionTS[], 'Add' as UpdateOperationTS);
  }
  if (changes.removed.length > 0) {
    await WorkspaceService.updateMemberPermissions(userId, domainId, changes.removed as PermissionTS[], 'Remove' as UpdateOperationTS);
  }
}
