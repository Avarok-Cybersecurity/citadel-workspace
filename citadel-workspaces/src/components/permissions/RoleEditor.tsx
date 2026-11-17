/**
 * The role table, editable as far as the reader's own role allows: the grid of what each role
 * may do, and the list of roles themselves.
 *
 * Save sends one `Update` per changed role carrying only what changed (use-role-editor), and
 * says nothing has been saved until the server's `RoleChanged` says so. A refusal is shown
 * here, inline and in the server's words, as well as in a toast.
 */
import type { Permission as WirePermission, RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { actorRole } from '@/lib/workspace-roles/role-ladder';
import { cellState, columnLock, type CellState } from '@/lib/workspace-roles/editor-rules';
import { togglePermission, type RoleDraft } from '@/lib/workspace-roles/role-diff';
import { PERMISSION_CATEGORIES, type PermissionDefinition } from './permission-constants';
import { PermissionMatrixTable } from './PermissionMatrixTable';
import { RoleListPanel } from './RoleListPanel';
import { useRoleEditor, type RoleEditor as Editor } from './use-role-editor';

const ALL_PERMISSIONS: [string, PermissionDefinition[]][] = Object.entries(PERMISSION_CATEGORIES);

export function RoleEditor({ table, onClose }: { table: WorkspaceRoles; onClose: () => void }): JSX.Element {
  const { state } = useWorkspace();
  const actor: RoleDefinition | null = actorRole(table, state.currentUser?.roleId);
  const editor: Editor = useRoleEditor(table);

  const cell = (role: RoleDefinition, permission: WirePermission): CellState =>
    cellState(actor, role, editor.draftFor(role).permissions, permission);
  const toggle = (role: RoleDefinition, permission: WirePermission, on: boolean): void => {
    const draft: RoleDraft = editor.draftFor(role);
    editor.edit(role, { ...draft, permissions: togglePermission(draft.permissions, permission, on) });
  };
  const lockOf = (role: RoleDefinition): string | null => columnLock(actor, role);
  const changed: number = editor.pending.length;

  return (
    <>
      <Tabs defaultValue="permissions" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-3 self-start sm:mx-6">
          <TabsTrigger value="permissions" className="min-h-[32px]" data-testid="role-tab-permissions">Permissions</TabsTrigger>
          <TabsTrigger value="roles" className="min-h-[32px]" data-testid="role-tab-roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="permissions" className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <PermissionMatrixTable allPermissions={ALL_PERMISSIONS} roles={table.roles} cell={cell} lockOf={lockOf} onToggle={toggle} />
        </TabsContent>
        <TabsContent value="roles" className="mt-0 min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
          <RoleListPanel table={table} actor={actor} editor={editor} />
        </TabsContent>
      </Tabs>

      {editor.refusal !== null && (
        <p role="alert" className="flex-shrink-0 border-t border-border px-6 py-2 text-sm text-destructive-emphasis" data-testid="role-editor-refusal">
          {editor.refusal}
        </p>
      )}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
        {changed > 0 && <span className="mr-auto text-xs text-muted-foreground" data-testid="role-editor-pending">{`${changed} role${changed === 1 ? '' : 's'} changed`}</span>}
        {changed > 0 && <Button variant="outline" onClick={editor.discard} disabled={editor.busy} className="h-[36px] text-sm">Discard</Button>}
        {changed > 0 && (
          <Button onClick={(): void => { void editor.save(); }} disabled={editor.busy} className="h-[36px] text-sm" data-testid="role-editor-save">
            {editor.busy ? 'Saving…' : 'Save'}
          </Button>
        )}
        <Button variant="outline" onClick={onClose} className="h-[36px] text-sm">Close</Button>
      </div>
    </>
  );
}
