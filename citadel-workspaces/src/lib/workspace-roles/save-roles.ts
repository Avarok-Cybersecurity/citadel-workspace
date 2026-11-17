/**
 * Save: one `Update` per changed role, in turn, each carrying only that role's changes.
 *
 * Sequential, and stopping at the first refusal: the protocol has no request id, so two edits
 * of the same kind in flight could take each other's answer. Each call resolves only when the
 * server's `RoleChanged` arrives, so nothing here reports a save that did not happen.
 */
import type { RoleChange, WorkspaceRoles } from 'citadel-workspace-client-ts';

export interface PendingUpdate {
  id: string;
  name: string;
  changes: RoleChange[];
}

export interface SaveOutcome {
  /** The roles the server accepted, in order. */
  saved: string[];
  /** The server's refusal, word for word, and which role it refused; null when all were saved. */
  refused: { id: string; name: string; reason: string } | null;
}

export async function savePending(
  pending: readonly PendingUpdate[],
  update: (id: string, changes: RoleChange[]) => Promise<WorkspaceRoles>,
): Promise<SaveOutcome> {
  const saved: string[] = [];
  for (const role of pending) {
    try {
      await update(role.id, role.changes);
      saved.push(role.id);
    } catch (error: unknown) {
      const reason: string = error instanceof Error && error.message ? error.message : 'The server did not accept the change.';
      return { saved, refused: { id: role.id, name: role.name, reason } };
    }
  }
  return { saved, refused: null };
}
