import { Shield, CreditCard, Building2 } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

interface AdminSettingsMenuProps {
  /** The reader may edit the workspace's profile (UpdateWorkspace). */
  readonly canEditWorkspace: boolean;
  /** A hosted workspace, for someone who configures it: it has a plan to manage. */
  readonly offersBilling: boolean;
  readonly onWorkspaceSettings: () => void;
  readonly onRolePermissions: () => void;
  readonly onBilling: () => void;
}

/**
 * The rows of the sidebar's Admin section, drawn from what the section has already decided
 * (AdminSettingsSection asks the permissions); each row opens its dialog there.
 */
export function AdminSettingsMenu({ canEditWorkspace, offersBilling, onWorkspaceSettings, onRolePermissions, onBilling }: AdminSettingsMenuProps): JSX.Element {
  return (
    <SidebarGroup className="flex-shrink-0 min-h-[2rem] mb-4">
      <div className="flex items-center gap-2 px-3 mb-2">
        <SidebarGroupLabel className="text-warning-emphasis font-semibold m-0 px-0">
          ADMIN SETTINGS
        </SidebarGroupLabel>
        <Badge className="h-5 px-1.5 bg-warning text-warning-foreground text-xs">
          Admin
        </Badge>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          {canEditWorkspace && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onWorkspaceSettings}
                data-testid="open-workspace-settings"
                className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
              >
                <Building2 className="h-4 w-4 mr-2 text-warning-emphasis" />
                Workspace settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onRolePermissions}
              data-testid="open-role-permissions"
              className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
            >
              <Shield className="h-4 w-4 mr-2 text-warning-emphasis" />
              {/* What each ROLE can do, workspace-wide. One person's permissions are
                  on their own row's menu, in a view about them. */}
              Role permissions
            </SidebarMenuButton>
          </SidebarMenuItem>
          {offersBilling && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onBilling}
                data-testid="open-plan-and-billing"
                className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
              >
                <CreditCard className="h-4 w-4 mr-2 text-warning-emphasis" />
                Plan & billing
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
