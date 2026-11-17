/**
 * The role editor's unsaved edits, and the requests that commit them.
 *
 * Drafts are kept per role and compared with the LIVE table each render, so what Save sends is
 * the difference from what the server holds now: a colleague's rename that lands while you tick
 * boxes is not undone by your Save, and a role they deleted drops out of yours.
 *
 * Moving, creating and deleting a role are single requests, sent at once; renames, colours and
 * permissions wait for Save. Either way the change shows when the server's `RoleChanged` does,
 * never before, and a refusal is shown in the server's words.
 */
import { useCallback, useMemo, useState } from 'react';
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { toast } from '@/hooks/use-toast';
import { rolesApi } from '@/lib/workspace-roles/roles-api';
import { draftOf, roleChanges, type RoleDraft } from '@/lib/workspace-roles/role-diff';
import { savePending, type PendingUpdate, type SaveOutcome } from '@/lib/workspace-roles/save-roles';

export interface RoleEditor {
  draftFor: (role: RoleDefinition) => RoleDraft;
  edit: (role: RoleDefinition, next: RoleDraft) => void;
  pending: PendingUpdate[];
  /** A request is out: Save, or a move, create or delete. */
  busy: boolean;
  /** The last refusal, verbatim; cleared by the next attempt. */
  refusal: string | null;
  save: () => Promise<void>;
  discard: () => void;
  /** Send one immediate request (move, create, delete); resolves whether it was accepted. */
  run: (what: string, request: () => Promise<WorkspaceRoles>) => Promise<boolean>;
}

function refuse(setRefusal: (reason: string) => void, title: string, reason: string): void {
  setRefusal(reason);
  toast({ title, description: reason, variant: 'destructive' });
}

export function useRoleEditor(table: WorkspaceRoles): RoleEditor {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, RoleDraft>>(new Map());
  const [busy, setBusy] = useState<boolean>(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const draftFor: RoleEditor['draftFor'] = useCallback((role: RoleDefinition): RoleDraft => drafts.get(role.id) ?? draftOf(role), [drafts]);

  const edit: RoleEditor['edit'] = useCallback((role: RoleDefinition, next: RoleDraft): void => {
    setDrafts((prev: ReadonlyMap<string, RoleDraft>): ReadonlyMap<string, RoleDraft> => new Map(prev).set(role.id, next));
  }, []);

  const pending: PendingUpdate[] = useMemo((): PendingUpdate[] => table.roles.flatMap((role: RoleDefinition): PendingUpdate[] => {
    const draft: RoleDraft | undefined = drafts.get(role.id);
    if (draft === undefined) return [];
    const changes: PendingUpdate['changes'] = roleChanges(role, draft);
    return changes.length > 0 ? [{ id: role.id, name: role.name, changes }] : [];
  }), [table, drafts]);

  const save: RoleEditor['save'] = useCallback(async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    const outcome: SaveOutcome = await savePending(pending, rolesApi.update);
    setDrafts((prev: ReadonlyMap<string, RoleDraft>): ReadonlyMap<string, RoleDraft> => {
      const next: Map<string, RoleDraft> = new Map(prev);
      for (const id of outcome.saved) next.delete(id);
      return next;
    });
    setBusy(false);
    if (outcome.refused !== null) refuse(setRefusal, `Could not save ${outcome.refused.name}`, outcome.refused.reason);
    else if (outcome.saved.length > 0) toast({ title: 'Roles saved', variant: 'success' });
  }, [pending]);

  const discard: RoleEditor['discard'] = useCallback((): void => { setDrafts(new Map()); setRefusal(null); }, []);

  const run: RoleEditor['run'] = useCallback(async (what: string, request: () => Promise<WorkspaceRoles>): Promise<boolean> => {
    setBusy(true);
    setRefusal(null);
    try {
      await request();
      return true;
    } catch (error: unknown) {
      refuse(setRefusal, `Could not ${what}`, error instanceof Error && error.message ? error.message : 'The server did not accept the change.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { draftFor, edit, pending, busy, refusal, save, discard, run };
}
