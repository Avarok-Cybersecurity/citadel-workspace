/**
 * A member's role as an icon in a round chip.
 *
 * The chip takes its fill, border and foreground from roleBadgeClass, so rank
 * keeps the same visual weight and the same AA-checked pairs as the text
 * badge. Colour and shape are never the only signal: the chip is role="img"
 * with the role's name, so it reads aloud and tests find it by name.
 *
 * The name is the role table's (an admin may rename "Admin" to "Moderators");
 * the icon follows the built-in role's id, which a rename does not change, and a
 * created role takes the plain one.
 */
import { Crown, ShieldCheck, Ticket, User, type LucideIcon } from 'lucide-react';
import { roleBadgeClass } from '@/lib/role-badge';
import { cn } from '@/lib/utils';
import { useRoleDisplay } from '@/hooks/use-workspace-roles';
import type { RoleDisplay } from '@/lib/workspace-roles/role-display';

const ROLE_ICON: Record<string, LucideIcon> = {
  owner: Crown,
  admin: ShieldCheck,
  member: User,
  guest: Ticket,
};

export interface RoleHolder {
  /** Their role-table id; see lib/workspace-roles. */
  roleId?: string;
  /** The legacy mirror, shown only when the id is not known. */
  role?: string;
}

/** The role's name as the table has it, or the mirror's while the table is on its way. */
export function useRoleName(holder: RoleHolder): string | null {
  return useRoleDisplay(holder.roleId, holder.role)?.name ?? null;
}

export function RoleIcon({ holder }: { holder: RoleHolder }): JSX.Element | null {
  const display: RoleDisplay | null = useRoleDisplay(holder.roleId, holder.role);
  if (display === null) return null;
  const Icon: LucideIcon = ROLE_ICON[display.id] ?? User;
  return (
    <span
      role="img"
      aria-label={display.name}
      data-role={display.id}
      className={cn(roleBadgeClass(display.id), 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full')}
    >
      <Icon className="h-3 w-3" aria-hidden="true" strokeWidth={2.25} />
    </span>
  );
}

/** The role's name as text, for a sentence or a tooltip; nothing when no role is known. */
export function RoleName({ holder }: { holder: RoleHolder }): JSX.Element | null {
  const name: string | null = useRoleName(holder);
  return name === null ? null : <>{name}</>;
}
