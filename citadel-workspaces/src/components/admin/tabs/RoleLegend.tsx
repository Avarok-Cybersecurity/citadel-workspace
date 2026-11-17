/** The workspace's roles, highest first, each with its colour: the key to the pickers above it. */
import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { Badge } from '@/components/ui/badge';
import { RoleDot } from '@/components/permissions/RoleDot';
import { useRoleTable } from '@/hooks/use-workspace-roles';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';

export function RoleLegend(): JSX.Element | null {
  const table: WorkspaceRoles | null = useRoleTable();
  if (table === null) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-border" data-testid="role-legend">
      {table.roles.map((role: RoleDefinition) => (
        <Badge key={role.id} variant="outline" className="gap-1 border-border text-muted-foreground">
          <RoleDot color={role.color} />
          {role.name}
        </Badge>
      ))}
    </div>
  );
}
