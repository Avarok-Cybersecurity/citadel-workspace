/**
 * The Roles tab: the workspace's roles, highest first, and creating, moving and deleting them.
 *
 * Deleting asks where the role's holders go and will not proceed until that is chosen: the
 * server requires it and picks none itself, so there is no default to fall back on. Only roles
 * the reader may hand out are offered, and never the one being deleted. Deleting the role new
 * members get says so, and which role takes its place.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DeleteRoleDialog } from '@/components/chat/GroupRoleHelpers';
import { rolesApi } from '@/lib/workspace-roles/roles-api';
import { columnLock } from '@/lib/workspace-roles/editor-rules';
import { grantsPermission, mayReassignTo } from '@/lib/workspace-roles/role-ladder';
import { movedPosition } from '@/lib/workspace-roles/role-positions';
import { Permission } from '@/lib/permissions-service/types';
import type { NewRole } from '@/lib/workspace-service/roles-operations';
import type { RoleDraft } from '@/lib/workspace-roles/role-diff';
import { deletingDefaultNotice } from '@/lib/workspace-roles/default-role-notice';
import { CreateRoleForm } from './CreateRoleForm';
import { DefaultRolePicker } from './DefaultRolePicker';
import { RoleRow } from './RoleRow';
import type { RoleEditor } from './use-role-editor';

interface RoleListPanelProps {
  table: WorkspaceRoles;
  actor: RoleDefinition | null;
  editor: RoleEditor;
}

export function RoleListPanel({ table, actor, editor }: RoleListPanelProps): JSX.Element {
  const [creating, setCreating] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<RoleDefinition | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('');
  const targets: RoleDefinition[] = deleting === null || actor === null
    ? []
    : table.roles.filter((role: RoleDefinition): boolean => mayReassignTo(table, actor, deleting, role));
  const mayCreate: boolean = actor !== null && grantsPermission(actor, Permission.ManageRoles);

  const defaultNotice: string | null = deleting === null ? null : deletingDefaultNotice(table, deleting, reassignTo);

  const create = (role: NewRole): Promise<boolean> => editor.run('create the role', () => rolesApi.create(role));
  const makeDefault = (id: string): void => {
    const _: Promise<boolean> = editor.run('change the role new members get', () => rolesApi.update(id, ['MakeDefault']));
  };
  const closeDelete = (): void => { setDeleting(null); setReassignTo(''); };
  const confirmDelete = (): void => {
    if (deleting === null || reassignTo === '') return;
    const id: string = deleting.id;
    const _: Promise<boolean> = editor.run('delete the role', () => rolesApi.remove(id, reassignTo));
    closeDelete();
  };

  return (
    <div className="space-y-3 px-3 py-3 sm:px-6" data-testid="role-list-panel">
      <DefaultRolePicker table={table} actor={actor} busy={editor.busy} onChoose={makeDefault} />
      <ul className="space-y-2">
        {table.roles.map((role: RoleDefinition) => (
          <RoleRow
            key={role.id}
            role={role}
            isDefault={role.id === table.default_role_id}
            draft={editor.draftFor(role)}
            lock={columnLock(actor, role)}
            upTo={actor === null ? null : movedPosition(table, actor, role, -1)}
            downTo={actor === null ? null : movedPosition(table, actor, role, 1)}
            busy={editor.busy}
            onDraft={(next: RoleDraft): void => editor.edit(role, next)}
            onMove={(position: number): void => { const _: Promise<boolean> = editor.run('move the role', () => rolesApi.update(role.id, [{ Move: position }])); }}
            onDelete={(): void => setDeleting(role)}
          />
        ))}
      </ul>
      {mayCreate && actor !== null && (creating
        ? <CreateRoleForm table={table} actor={actor} busy={editor.busy} onCreate={create} onCancel={(): void => setCreating(false)} />
        : (
          <Button type="button" variant="outline" className="h-[36px]" onClick={(): void => setCreating(true)} data-testid="new-role">
            <Plus className="mr-2 h-[16px] w-[16px]" aria-hidden="true" />New role
          </Button>
        ))}
      <DeleteRoleDialog
        roleToDelete={deleting}
        onOpenChange={closeDelete}
        onConfirm={confirmDelete}
        confirmDisabled={reassignTo === ''}
        description="This cannot be undone. Everyone who holds it moves to the role you choose."
      >
        <div className="space-y-2">
          <Label htmlFor="reassign-to">Move its holders to</Label>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger id="reassign-to" className="h-[36px]" data-testid="reassign-to"><SelectValue placeholder="Choose a role" /></SelectTrigger>
            <SelectContent>
              {targets.map((role: RoleDefinition) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {targets.length === 0 && <p className="text-xs text-muted-foreground">There is no role you may move them to.</p>}
          {defaultNotice !== null && <p className="text-sm text-foreground" data-testid="delete-default-notice">{defaultNotice}</p>}
        </div>
      </DeleteRoleDialog>
    </div>
  );
}
