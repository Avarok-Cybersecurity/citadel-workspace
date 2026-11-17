/**
 * Permission display widgets: RoleBadge, PermissionStatus, GroupedPermissionTable
 */

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';


import { usePermissions, PERMISSION_CATEGORIES } from '@/contexts/PermissionsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { MemberRoleBadge } from '@/components/shared/MemberRoleBadge';
import { cn } from '@/lib/utils';

/** Your workspace role, from the role table; "Unknown" until it is known. A role is workspace-wide. */
export function RoleBadge(): JSX.Element {
  const { state } = useWorkspace();
  const holder: { roleId?: string; role?: string } = { roleId: state.currentUser?.roleId, role: state.currentUser?.role };
  if (holder.roleId === undefined && holder.role === undefined) {
    return <Badge variant="outline" className="text-muted-foreground border-border">Unknown</Badge>;
  }
  return <MemberRoleBadge holder={holder} className="font-medium" />;
}

/**
 * Permission status icon
 */
export function PermissionStatus({ allowed }: { allowed: boolean }): JSX.Element {
  if (allowed) {
    return (
      <div className="flex items-center gap-1.5 text-success-emphasis">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm">Allowed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-destructive-emphasis">
      <XCircle className="h-4 w-4" />
      <span className="text-sm">Denied</span>
    </div>
  );
}

/**
 * Permission table for a specific domain
 */
export function GroupedPermissionTable({ domainId }: { domainId: string }): JSX.Element {
  const { hasPermission, getPermissionLabel } = usePermissions();
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['content', 'messaging']);

  return (
    <Accordion
      type="multiple"
      value={expandedCategories}
      onValueChange={setExpandedCategories}
      className="w-full"
    >
      {Object.entries(PERMISSION_CATEGORIES).map(([key, category]) => {
        const allowedCount: number = category.permissions.filter(p => hasPermission(domainId, p)).length;
        const totalCount: number = category.permissions.length;

        return (
          <AccordionItem key={key} value={key} className="border-border/50">
            <AccordionTrigger className="text-foreground/80 hover:text-foreground hover:no-underline py-2">
              <div className="flex items-center gap-3">
                <span>{category.label}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs',
                    allowedCount === totalCount
                      ? 'bg-success/20 text-success-emphasis border-success/50'
                      : allowedCount === 0
                        ? 'bg-destructive/20 text-destructive-emphasis border-destructive/50'
                        : 'bg-warning/20 text-warning-emphasis border-warning/50'
                  )}
                >
                  {allowedCount}/{totalCount}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 pl-4">
                {category.permissions.map((permission) => (
                  <div
                    key={permission}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="text-muted-foreground">{getPermissionLabel(permission)}</span>
                    <PermissionStatus allowed={hasPermission(domainId, permission)} />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
