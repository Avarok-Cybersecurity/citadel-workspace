import { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoleColorPicker } from './RoleColorPicker';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { DEFAULT_MEMBER_PERMISSIONS , type GroupPermissions } from '@/types/group';
import { PERMISSION_LABELS , type GroupRoleEditorProps } from './GroupRoleEditorConstants';

// ============================================================================
// Component
// ============================================================================

export function GroupRoleEditor({
  open,
  onOpenChange,
  role,
  existingRoles,
  suggestedPosition,
  onSave,
}: GroupRoleEditorProps): JSX.Element {
  // NOT annotated, and it is the one on this screen that cannot be.
  //
  // Since TS 4.4 a `const` holding a condition narrows what it tested, so
  // Tested against `role` directly where the role's own fields are read; the
  // boolean is for labels only, which is why it can now carry a type.
  const isEditing: boolean = role !== null;
  const isBuiltIn: boolean = role?.isBuiltIn ?? false;

  // Initialize state
  const [name, setName] = useState(role?.name || '');
  const [position, setPosition] = useState(role?.position ?? suggestedPosition);
  const [color, setColor] = useState(role?.color || '');
  const [permissions, setPermissions] = useState<GroupPermissions>(
    role?.permissions || { ...DEFAULT_MEMBER_PERMISSIONS }
  );
  const [isDefault, setIsDefault] = useState(role?.isDefault ?? false);

  // Validation
  // `ReturnType<typeof useMemo>` said nothing: useMemo is generic, so that
  // resolves to nothing useful. This is a validity flag.
  const isPositionValid: boolean = useMemo((): boolean => {
    if (position < 1 || position > 99) return false;
    return !existingRoles.some(
      r => r.position === position && r.id !== role?.id
    );
  }, [position, existingRoles, role]);

  const isNameValid: boolean = name.trim().length > 0;
  const canSave: boolean = isNameValid && isPositionValid;

  // Handlers
  const handlePermissionChange: (key: keyof GroupPermissions, checked: boolean) => void = useCallback(
    (key: keyof GroupPermissions, checked: boolean) => {
      setPermissions(prev => ({ ...prev, [key]: checked }));
    },
    []
  );

  const handleSave: () => void = useCallback((): void => {
    if (!canSave) return;

    onSave({
      name: name.trim(),
      position,
      color: color || undefined,
      permissions,
      isDefault,
    });
  }, [canSave, name, position, color, permissions, isDefault, onSave]);

  const handleClose: () => void = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] bg-background border-border text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {role ? `Edit Role: ${role.name}` : 'Create New Role'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isBuiltIn
              ? 'Built-in roles can only have their name and color changed.'
              : 'Configure the role name, position, and permissions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="roleName" className="text-sm text-foreground/80">
              Role Name
            </Label>
            <Input
              id="roleName"
              placeholder="e.g., Moderator"
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-surface border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {/* Position (disabled for built-in roles) */}
          <div className="space-y-2">
            <Label htmlFor="rolePosition" className="text-sm text-foreground/80">
              Position (1-99, higher = more authority)
            </Label>
            <Input
              id="rolePosition"
              type="number"
              min={1}
              max={99}
              value={position}
              onChange={e => setPosition(parseInt(e.target.value) || 0)}
              disabled={isBuiltIn}
              className={`bg-surface border-border text-foreground ${
                !isPositionValid ? 'border-destructive' : ''
              } ${isBuiltIn ? 'opacity-50' : ''}`}
            />
            {!isPositionValid && (
              <p className="text-xs text-destructive-emphasis">
                Position must be unique and between 1-99
              </p>
            )}
          </div>

          {/* Color */}
          <RoleColorPicker color={color} onChange={setColor} />

          <Separator className="bg-border" />

          {/* Permissions (disabled for built-in roles) */}
          <div className="space-y-3">
            <Label className="text-sm text-foreground/80">Permissions</Label>
            {isBuiltIn && (
              <p className="text-xs text-warning-emphasis">
                Built-in role permissions cannot be modified.
              </p>
            )}
            <div className="space-y-3">
              {(Object.keys(PERMISSION_LABELS) as Array<keyof GroupPermissions>).map(
                key => (
                  <div
                    key={key}
                    className={`flex items-start gap-3 p-2 rounded ${
                      isBuiltIn ? 'opacity-50' : 'hover:bg-surface'
                    }`}
                  >
                    <Checkbox
                      id={`perm-${key}`}
                      checked={permissions[key]}
                      onCheckedChange={checked =>
                        handlePermissionChange(key, !!checked)
                      }
                      disabled={isBuiltIn}
                      className="mt-0.5 border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <div className="flex-1">
                      <label
                        htmlFor={`perm-${key}`}
                        className="text-sm font-medium text-foreground cursor-pointer"
                      >
                        {PERMISSION_LABELS[key].label}
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {PERMISSION_LABELS[key].description}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Default Role Toggle */}
          <div className="flex items-center justify-between p-2 rounded hover:bg-surface">
            <div>
              <Label htmlFor="default-role" className="text-sm text-foreground">Set as Default Role</Label>
              <p className="text-xs text-muted-foreground">
                New members will be assigned this role when they join
              </p>
            </div>
            <Checkbox
              id="default-role"
              checked={isDefault}
              onCheckedChange={checked => setIsDefault(!!checked)}
              disabled={isBuiltIn}
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className="bg-transparent border-border text-foreground hover:bg-surface"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="bg-primary text-primary-foreground"
          >
            {isEditing ? 'Save Changes' : 'Create Role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GroupRoleEditor;
