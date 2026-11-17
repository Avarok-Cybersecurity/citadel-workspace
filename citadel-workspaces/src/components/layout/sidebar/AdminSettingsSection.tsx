import { Settings, Shield, Users, Key, CreditCard, Building2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { PermissionManagerModal } from "@/components/permissions/PermissionManagerModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { connectionManager } from '@/lib/connection';
import { readControlPlaneBase } from '@/lib/onboarding/control-plane-config';
import { createControlPlane, type ControlPlane } from '@/lib/onboarding/control-plane-client';
import { planAndBillingSlug } from '@/lib/onboarding/billing-portal';
import { openBrowserPortalTab } from '@/lib/onboarding/browser-portal-tab';
import { ManageSubscriptionDialog } from './ManageSubscriptionDialog';
import { useWorkspaceAddress } from '@/hooks/use-workspace-address';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits } from '@/hooks/use-permission-result';
import { Permission } from '@/lib/permissions-service/types';
import { WorkspaceSettingsDialog } from '@/components/admin/workspace-settings/WorkspaceSettingsDialog';

/**
 * Admin Settings Section
 *
 * Only visible to those who manage roles or configure the workspace. Provides quick access to:
 * - Manage workspace permissions
 * - View/edit member roles
 * - Access admin-only settings
 */
export const AdminSettingsSection: () => JSX.Element | null = (): JSX.Element | null => {
  const { state } = useWorkspace();
  const [showPermissionManager, setShowPermissionManager] = useState(false);
  const [showAdminInfo, setShowAdminInfo] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  // The permission the server checks for UpdateWorkspaceProfile, asked of the root and of this
  // workspace, as the appearance editor asks for Themes.
  const workspaceId: string = state.workspace?.id ?? WORKSPACE_ROOT_ID;
  const rootPermission: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, Permission.UpdateWorkspace);
  const ownPermission: ReturnType<typeof usePermission> = usePermission(workspaceId, Permission.UpdateWorkspace);
  const canEditWorkspace: boolean = permits(rootPermission) || permits(ownPermission);
  // The section CLAIMS administration (its header says Admin), so it waits for a known yes:
  // `confirms`, not `permits`, or every Guest would see it while their answer is on its way.
  // Either permission makes someone an administrator here: ManageRoles for people and roles,
  // EditWorkspaceConfig for the workspace's own settings. Each control inside keeps its own gate.
  const managesRoles: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, Permission.ManageRoles));
  const configuresWorkspace: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, Permission.EditWorkspaceConfig));
  const controlPlaneBase: string | undefined = readControlPlaneBase(document);
  const api: ControlPlane | undefined = useMemo((): ControlPlane | undefined => controlPlaneBase === undefined
    ? undefined
    : createControlPlane((input: string, init?: RequestInit): Promise<Response> => fetch(input, init), controlPlaneBase),
  [controlPlaneBase]);
  const serverAddress: string | undefined = useWorkspaceAddress(
    configuresWorkspace && controlPlaneBase !== undefined,
    connectionManager.getConnectionInfo()?.serverAddress,
  );
  // Hosted workspaces only: a self-hosted server has no plan, and a page with no
  // control plane has nobody to ask.
  const billingSlug: string | undefined = planAndBillingSlug({
    configuresWorkspace,
    serverAddress,
    controlPlaneBase,
  });

  // A permission, not a role name: the same question TopBar's ring and the switcher's shield ask
  // (ManageRoles), plus the workspace's own settings, so nobody is an administrator in two
  // places and not in the third.
  const isAdmin: boolean = managesRoles || configuresWorkspace;

  if (!isAdmin) {
    return null;
  }

  return (
    <>
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
                  onClick={() => setShowWorkspaceSettings(true)}
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
                onClick={() => setShowPermissionManager(true)}
                data-testid="open-role-permissions"
                className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
              >
                <Shield className="h-4 w-4 mr-2 text-warning-emphasis" />
                {/* What each ROLE can do, workspace-wide. One person's permissions are
                    on their own row's menu, in a view about them. */}
                Role permissions
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setShowAdminInfo(true)}
                className="text-foreground hover:bg-primary-accent/15 hover:text-foreground transition-colors"
              >
                <Key className="h-4 w-4 mr-2 text-warning-emphasis" />
                Admin Privileges
              </SidebarMenuButton>
            </SidebarMenuItem>
            {billingSlug !== undefined && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setShowBilling(true)}
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

      {/* Mounted only while open, so it seeds from the stored record each time. */}
      {showWorkspaceSettings && (
        <WorkspaceSettingsDialog open onOpenChange={setShowWorkspaceSettings} />
      )}

      {/* The role table: what each role can do, editable with ManageRoles. */}
      <PermissionManagerModal isOpen={showPermissionManager} onClose={() => setShowPermissionManager(false)} />

      {billingSlug !== undefined && api !== undefined && (
        <ManageSubscriptionDialog
          open={showBilling}
          onOpenChange={setShowBilling}
          slug={billingSlug}
          api={api}
          openTab={openBrowserPortalTab}
        />
      )}

      {/* Admin Info Dialog */}
      <Dialog open={showAdminInfo} onOpenChange={setShowAdminInfo}>
        <DialogContent className="bg-surface border-warning/30">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Shield className="h-5 w-5 text-warning-emphasis" />
              Administrator Privileges
            </DialogTitle>
            <DialogDescription className="text-foreground/80">
              As a workspace administrator, you have full access to:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-foreground">
            <div className="flex items-start gap-3 p-2 bg-warning/10 rounded">
              <Settings className="h-4 w-4 text-warning-emphasis mt-0.5" />
              <div>
                {/* "Nodes" and "hierarchy nodes" are the code's words for
                    offices and rooms; the result toasts already use the real
                    ones, so the same thing had two names either side of a
                    click. */}
                <p className="font-medium">Offices & Rooms</p>
                <p className="text-sm text-muted-foreground">Create, rename and remove them</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-2 bg-warning/10 rounded">
              <Users className="h-4 w-4 text-warning-emphasis mt-0.5" />
              <div>
                <p className="font-medium">Manage User Roles</p>
                <p className="text-sm text-muted-foreground">Give people roles, and decide what each role can do</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-2 bg-warning/10 rounded">
              <Shield className="h-4 w-4 text-warning-emphasis mt-0.5" />
              <div>
                <p className="font-medium">Grant Permissions</p>
                <p className="text-sm text-muted-foreground">Choose what each person can do, anywhere in the workspace</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-2 bg-warning/10 rounded">
              <Key className="h-4 w-4 text-warning-emphasis mt-0.5" />
              <div>
                <p className="font-medium">Configure Workspace</p>
                <p className="text-sm text-muted-foreground">Update workspace settings and configuration</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
