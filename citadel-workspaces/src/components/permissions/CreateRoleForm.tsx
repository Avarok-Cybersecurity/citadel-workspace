/**
 * A new role: its name, colour, where it sits, and what it starts with.
 *
 * Nothing is chosen for the admin. Where a role sits decides who may manage it and whom it
 * outranks, so the placement must be picked; and only permissions the admin holds are offered,
 * since the server refuses granting any other.
 */
import { useState } from 'react';
import type { Permission as WirePermission, RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RoleColorPicker } from '@/components/chat/RoleColorPicker';
import { grantsPermission, outranks } from '@/lib/workspace-roles/role-ladder';
import { placementAbove } from '@/lib/workspace-roles/role-positions';
import type { NewRole } from '@/lib/workspace-service/roles-operations';
import { PERMISSION_CATEGORIES, type PermissionDefinition } from './permission-constants';

const BOTTOM: string = 'bottom';

interface CreateRoleFormProps {
  table: WorkspaceRoles;
  actor: RoleDefinition;
  busy: boolean;
  onCreate: (role: NewRole) => Promise<boolean>;
  onCancel: () => void;
}

export function CreateRoleForm({ table, actor, busy, onCreate, onCancel }: CreateRoleFormProps): JSX.Element {
  const [name, setName] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [anchor, setAnchor] = useState<string>('');
  const [granted, setGranted] = useState<ReadonlySet<WirePermission>>(new Set());
  const anchors: RoleDefinition[] = table.roles.filter((role: RoleDefinition): boolean => outranks(actor, role.position) && role.id !== actor.id);
  const anchorRole: RoleDefinition | null = anchors.find((role: RoleDefinition): boolean => role.id === anchor) ?? null;
  const position: number | null = anchor === '' ? null : placementAbove(table, actor, anchor === BOTTOM ? null : anchorRole);
  const ready: boolean = name.trim() !== '' && position !== null && !busy;

  const toggle = (permission: WirePermission, on: boolean): void => {
    const next: Set<WirePermission> = new Set(granted);
    if (on) next.add(permission); else next.delete(permission);
    setGranted(next);
  };
  const submit = async (): Promise<void> => {
    if (position === null) return;
    const made: boolean = await onCreate({ name, permissions: [...granted], position, color: color === '' ? null : color });
    if (made) onCancel();
  };

  return (
    <form className="space-y-4 rounded-lg border border-border p-3" data-testid="create-role-form"
      onSubmit={(event: React.FormEvent<HTMLFormElement>): void => { event.preventDefault(); void submit(); }}>
      <div className="space-y-2">
        <Label htmlFor="new-role-name">Name</Label>
        <Input id="new-role-name" value={name} maxLength={48} onChange={(event: React.ChangeEvent<HTMLInputElement>): void => setName(event.target.value)} data-testid="new-role-name" />
      </div>
      <RoleColorPicker color={color} onChange={setColor} />
      <div className="space-y-2">
        <Label htmlFor="new-role-place">Where it sits</Label>
        <Select value={anchor} onValueChange={setAnchor}>
          <SelectTrigger id="new-role-place" className="h-[36px]" data-testid="new-role-place"><SelectValue placeholder="Choose where it sits" /></SelectTrigger>
          <SelectContent>
            {anchors.map((role: RoleDefinition) => <SelectItem key={role.id} value={role.id}>{`Just above ${role.name}`}</SelectItem>)}
            <SelectItem value={BOTTOM}>At the bottom</SelectItem>
          </SelectContent>
        </Select>
        {anchor !== '' && position === null && <p className="text-xs text-destructive-emphasis" role="alert">There is no room there. Choose another place.</p>}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">Starts with</legend>
        {Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]: [string, PermissionDefinition[]]) => {
          const offered: PermissionDefinition[] = permissions.filter((p: PermissionDefinition): boolean => grantsPermission(actor, p.id));
          if (offered.length === 0) return null;
          return (
            <div key={category} className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary-accent">{category}</p>
              {offered.map((p: PermissionDefinition) => (
                <label key={p.id} className="flex min-h-[32px] items-center gap-2 text-sm text-foreground/80">
                  <Checkbox checked={granted.has(p.id)} onCheckedChange={(on: boolean | 'indeterminate'): void => toggle(p.id, on === true)} aria-label={p.label} data-testid={`new-role-grant-${p.id}`} />
                  {p.label}
                </label>
              ))}
            </div>
          );
        })}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-[36px]" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="h-[36px]" disabled={!ready} data-testid="create-role-submit">Create role</Button>
      </div>
    </form>
  );
}
