/**
 * MemberRow sub-component for MembersTab.
 * Renders a single member row with avatar, role selector, and actions.
 */

import type { RoleDefinition } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { inheritedRemoveReason } from '@/lib/member-access';
import { grantsPermission } from '@/lib/workspace-roles/role-ladder';
import { Permission } from '@/lib/permissions-service/types';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { RoleDot } from '@/components/permissions/RoleDot';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, UserMinus, Shield } from 'lucide-react';
import type { MemberData } from '../types';

/** What may be done to this member, decided by the tab from the role ladder. */
export interface MemberRowRules {
  /** The table's roles, highest first; null until the table has arrived. */
  roles: RoleDefinition[] | null;
  /** Ids of the roles you may hand out. */
  assignable: ReadonlySet<string>;
  /**
   * This member is the workspace's last member able to manage roles.
   *
   * Demoting or removing them leaves nobody able to manage roles, and there is no way back.
   * The server refuses both, so this only decides whether the controls look available --
   * offering an action that will be rejected is worse than not offering it.
   */
  isOnlyManager: boolean;
  /** Why you cannot act on this member at all (their role is not below yours), or null. */
  actOnBlocked: string | null;
}

interface MemberRowProps {
  member: MemberData;
  showAdvanced: boolean;
  isUpdatingRole: boolean;
  rules: MemberRowRules;
  onRoleChange: (userId: string, newRole: RoleDefinition) => void;
  onAdvancedPermissions: (member: MemberData) => void;
  onRemove: (member: MemberData) => void;
}

export const LAST_MANAGER_REASON: string = 'This is the only member who can manage roles. Give that to someone else first.';

export function MemberRow({
  member,
  showAdvanced,
  isUpdatingRole,
  rules,
  onRoleChange,
  onAdvancedPermissions,
  onRemove,
}: MemberRowProps): JSX.Element {
  // Someone who reaches this node through a level above cannot be removed from it
  // here: the server refuses, since it would not take their access away.
  const removeBlocked: string | null = rules.actOnBlocked
    ?? (rules.isOnlyManager ? LAST_MANAGER_REASON
      : member.accessViaName !== undefined ? inheritedRemoveReason(member.accessViaName) : null);
  const offered = (role: RoleDefinition): boolean =>
    role.id === member.roleId || rules.assignable.has(role.id);
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 p-3 bg-card rounded-lg"
      data-testid={`member-row-${member.userId}`}
    >
      {/* min-w-0 + truncate here, shrink-0 on the controls opposite.
          A flex child's min-width defaults to its content, so a long username —
          generated handles here run past 20 characters — refused to shrink and
          pushed the role selector and the remove button off a 375px screen. The
          controls are the entire point of the row, so they are the last thing
          that may give way. Same reasoning as the TopBar header group.

          Stacked below `sm` rather than merely truncated: side by side on a
          375px screen the controls take ~180px of ~295, leaving so little for
          the name that it rendered as "a…" — reachable controls acting on an
          unidentifiable person. A row per line gives the name its own width. */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <MemberAvatar username={member.username} name={member.name || member.username} className="h-10 w-10 text-sm" />
        <div className="min-w-0">
          {/* break-all below `sm`, truncate above. Stacking alone still left the
              name 8px short of its box — a generated handle is one unbroken
              token, so it either wraps or loses characters, and losing them is
              what makes a member unidentifiable. Wrapping costs a line on a
              phone; clipping costs the identity. */}
          <div className="text-foreground font-medium break-all sm:truncate">
            {member.name || member.username}
          </div>
          {member.name && (
            <div className="text-muted-foreground text-sm break-all sm:truncate">
              @{member.username}
            </div>
          )}
          {member.isGuest && (
            <span className="text-xs font-medium text-muted-foreground" data-testid={`member-guest-${member.userId}`}>Guest from outside</span>
          )}
          {member.accessViaName !== undefined && (
            <div className="text-muted-foreground text-xs" data-testid={`member-access-via-${member.userId}`}>
              via {member.accessViaName}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        {showAdvanced ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAdvancedPermissions(member)}
            className="border-primary-accent text-primary-accent hover:bg-primary-accent/20"
            data-testid={`member-permissions-${member.userId}`}
          >
            <Shield className="h-4 w-4 mr-1" />
            Permissions
          </Button>
        ) : (
          <BlockedReason reason={rules.actOnBlocked}>
          <Select
            value={member.roleId}
            onValueChange={(value: string): void => {
              const chosen: RoleDefinition | undefined = rules.roles?.find((r: RoleDefinition): boolean => r.id === value);
              if (chosen) onRoleChange(member.userId, chosen);
            }}
            disabled={isUpdatingRole || rules.roles === null || rules.actOnBlocked !== null}
          >
            <SelectTrigger
              aria-label={`Role for ${member.username}`}
              className="w-32 bg-card text-foreground"
              data-testid={`member-role-select-${member.userId}`}
            >
              {isUpdatingRole || rules.roles === null ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading roles" />
              ) : (
                <SelectValue />
              )}
            </SelectTrigger>
            <SelectContent className="bg-card border-border">
              {(rules.roles ?? []).filter(offered).map((role: RoleDefinition) => (
                <SelectItem
                  key={role.id}
                  value={role.id}
                  // A role that cannot manage roles demotes the last member who can, and the
                  // server refuses it. Their current role stays selectable to keep it visible.
                  disabled={rules.isOnlyManager && !grantsPermission(role, Permission.ManageRoles)}
                  data-testid={`member-role-option-${role.id}`}
                >
                  <div className="flex items-center gap-2">
                    <RoleDot color={role.color} />
                    {role.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </BlockedReason>
        )}

        <BlockedReason reason={removeBlocked}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(member)}
            disabled={removeBlocked !== null}
            title={removeBlocked ?? `Remove ${member.username}`}
            aria-label={removeBlocked ?? `Remove ${member.username}`}
            className="text-destructive hover:text-destructive hover:bg-destructive/15"
            data-testid={`member-remove-${member.userId}`}
          >
            <UserMinus className="h-4 w-4" />
          </Button>
        </BlockedReason>
      </div>
    </div>
  );
}
