/**
 * "New members get": the role the table gives anyone who joins on their own.
 *
 * A choice sends one `MakeDefault` at once, like moving a role, and shows when the server's
 * `RoleChanged` does. Only roles the reader may make the default are offered (role-ladder); a
 * reader who may choose none sees the current default as text, not a control that cannot work.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultRole, mayMakeDefault } from '@/lib/workspace-roles/role-ladder';

interface DefaultRolePickerProps {
  table: WorkspaceRoles;
  actor: RoleDefinition | null;
  busy: boolean;
  onChoose: (roleId: string) => void;
}

export function DefaultRolePicker({ table, actor, busy, onChoose }: DefaultRolePickerProps): JSX.Element {
  const current: RoleDefinition | null = defaultRole(table);
  const choices: RoleDefinition[] = actor === null
    ? []
    : table.roles.filter((role: RoleDefinition): boolean => role.id !== current?.id && mayMakeDefault(actor, role));
  const name: string = current?.name ?? 'no role';
  if (choices.length === 0) {
    return <p className="text-sm text-foreground" data-testid="default-role">New members get: <span className="font-medium">{name}</span></p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="default-role" className="text-sm">New members get</Label>
      <Select value={current?.id ?? ''} onValueChange={(id: string): void => { if (id !== current?.id) onChoose(id); }} disabled={busy}>
        <SelectTrigger id="default-role" className="h-[36px] w-auto min-w-[160px]" data-testid="default-role-picker"><SelectValue placeholder="Choose a role" /></SelectTrigger>
        <SelectContent>
          {current !== null && <SelectItem value={current.id}>{current.name}</SelectItem>}
          {choices.map((role: RoleDefinition) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
