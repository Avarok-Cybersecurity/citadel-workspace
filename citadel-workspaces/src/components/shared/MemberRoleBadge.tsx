/**
 * A member's role as a text badge: the table's name, with its colour as a dot when it has one.
 *
 * Colour is never the only signal; the name is the badge's text. The badge's own fill comes from
 * roleBadgeClass, keyed by the role's id, so the AA-checked pairs hold whatever colour an admin
 * picked: the picked colour tints only the dot.
 */
import { Badge } from '@/components/ui/badge';
import { roleBadgeClass } from '@/lib/role-badge';
import { cn } from '@/lib/utils';
import { useRoleDisplay } from '@/hooks/use-workspace-roles';
import type { RoleDisplay } from '@/lib/workspace-roles/role-display';
import type { RoleHolder } from './RoleIcon';
import { RoleDot } from '@/components/permissions/RoleDot';

interface MemberRoleBadgeProps {
  holder: RoleHolder;
  className?: string;
  'data-testid'?: string;
}

export function MemberRoleBadge({ holder, className, 'data-testid': testId }: MemberRoleBadgeProps): JSX.Element | null {
  const display: RoleDisplay | null = useRoleDisplay(holder.roleId, holder.role);
  if (display === null) return null;
  return (
    <Badge className={cn('shrink-0 gap-1', roleBadgeClass(display.id), className)} data-role={display.id} data-testid={testId}>
      {display.color !== null && <RoleDot color={display.color} />}
      {display.name}
    </Badge>
  );
}
