/**
 * GroupRoleManagement - Displays and manages roles for a group.
 * Allows creating, editing, and deleting roles (respecting hierarchy).
 */
import { useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Star, Lock, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { GroupRole, GroupConversation, GroupSettings } from '@/types/group';
import { useGroupRoles } from '@/hooks/use-group-roles';
import { useGroupPermissions } from '@/hooks/use-group-permissions';
import { GroupRoleEditor } from './GroupRoleEditor';
import { formatPermissions, canManageSpecificRole, DeleteRoleDialog } from './GroupRoleHelpers';

interface GroupRoleManagementProps {
  group: GroupConversation;
  onSettingsChange: (settings: GroupSettings) => void;
}

export function GroupRoleManagement({ group, onSettingsChange }: GroupRoleManagementProps): JSX.Element {
  const {
    roles, defaultRole, createRole, updateRole, deleteRole,
    setDefaultRole, canManageRole, suggestPosition,
  } = useGroupRoles(group, onSettingsChange);

  const { myRole, can } = useGroupPermissions(group);

  const [showEditor, setShowEditor] = useState(false);
  const [editingRole, setEditingRole] = useState<GroupRole | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<GroupRole | null>(null);

  const canManageRoles: boolean = can('manageRoles');

  const handleCreateRole: () => void = useCallback((): void => {
    setEditingRole(null);
    setShowEditor(true);
  }, []);

  const handleEditRole: (role: GroupRole) => void = useCallback((role: GroupRole): void => {
    setEditingRole(role);
    setShowEditor(true);
  }, []);

  const handleDeleteRole: (role: GroupRole) => void = useCallback((role: GroupRole): void => {
    setRoleToDelete(role);
  }, []);

  const confirmDelete: () => void = useCallback((): void => {
    if (roleToDelete) {
      deleteRole(roleToDelete.id);
      setRoleToDelete(null);
    }
  }, [roleToDelete, deleteRole]);

  const handleSaveRole: (roleData: Omit<GroupRole, "id" | "isBuiltIn">) => void = useCallback(
    (roleData: Omit<GroupRole, 'id' | 'isBuiltIn'>) => {
      if (editingRole) {
        updateRole(editingRole.id, roleData);
      } else {
        createRole(roleData.name, roleData.position, roleData.permissions, roleData.color);
      }
      setShowEditor(false);
      setEditingRole(null);
    },
    [editingRole, createRole, updateRole]
  );

  const handleSetDefault: (roleId: string) => void = useCallback(
    (roleId: string) => { setDefaultRole(roleId); },
    [setDefaultRole]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Roles</h3>
        {canManageRoles && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateRole}
            className="h-8 bg-surface border-border text-foreground hover:bg-border"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Role
          </Button>
        )}
      </div>

      {/* Role List */}
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-2">
          {roles.map(role => {
            const isDefault: boolean = role.id === defaultRole?.id;
            const canEdit: boolean = canManageSpecificRole(myRole?.id, canManageRoles, role, canManageRole);
            const canDelete: boolean = canEdit && !isDefault;

            return (
              <div
                key={role.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border group"
              >
                <div className="text-muted-foreground cursor-grab">
                  <GripVertical className="h-4 w-4" />
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {role.color ? (
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-muted-foreground" />
                  )}
                  {role.isBuiltIn && (
                    <span title="Built-in role"><Lock className="h-3 w-3 text-warning-emphasis" /></span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{role.name}</span>
                    <span className="text-xs text-muted-foreground">(position: {role.position})</span>
                    {isDefault && (
                      <Badge
                        variant="outline"
                        className="h-5 text-xs bg-primary/20 border-primary text-primary-accent"
                      >
                        <Star className="h-3 w-3 mr-1" />
                        Default
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{formatPermissions(role)}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 reveal-on-hover">
                  {!isDefault && canManageRoles && !role.isBuiltIn && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-warning-emphasis hover:text-warning-emphasis hover:bg-warning/10"
                      onClick={() => handleSetDefault(role.id)}
                      title="Set as default role"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  {(canEdit || role.isBuiltIn) && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-border"
                      onClick={() => handleEditRole(role)}
                      title="Edit role"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteRole(role)}
                      title="Delete role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Role Editor Dialog */}
      {showEditor && (
        <GroupRoleEditor
          open={showEditor}
          onOpenChange={open => {
            setShowEditor(open);
            if (!open) setEditingRole(null);
          }}
          role={editingRole}
          existingRoles={roles}
          suggestedPosition={suggestPosition()}
          onSave={handleSaveRole}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteRoleDialog
        roleToDelete={roleToDelete}
        onOpenChange={() => setRoleToDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default GroupRoleManagement;
