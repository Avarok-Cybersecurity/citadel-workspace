import { useMemo, useState } from "react";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { PermissionManagerModal } from "@/components/permissions/PermissionManagerModal";
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { connectionManager } from '@/lib/connection';
import { readControlPlaneBase } from '@/lib/onboarding/control-plane-config';
import { createControlPlane, type ControlPlane } from '@/lib/onboarding/control-plane-client';
import { planAndBillingSlug } from '@/lib/onboarding/billing-portal';
import { openBrowserPortalTab } from '@/lib/onboarding/browser-portal-tab';
import { ManageSubscriptionDialog } from './ManageSubscriptionDialog';
import { AdminSettingsMenu } from './AdminSettingsMenu';
import { useWorkspaceAddress } from '@/hooks/use-workspace-address';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits } from '@/hooks/use-permission-result';
import { WorkspaceSettingsDialog } from '@/components/admin/workspace-settings/WorkspaceSettingsDialog';
import WorkspaceService from '@/lib/workspace-service';

/**
 * Admin Settings Section
 *
 * Only visible to those who manage roles or configure the workspace: the workspace's settings,
 * what each role can do, and (hosted workspaces) its plan.
 */
export const AdminSettingsSection: () => JSX.Element | null = (): JSX.Element | null => {
  const { state } = useWorkspace();
  const [showPermissionManager, setShowPermissionManager] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  // The permission the server checks for UpdateWorkspaceProfile, asked of the root and of this
  // workspace, as the appearance editor asks for Themes.
  const workspaceId: string = state.workspace?.id ?? WORKSPACE_ROOT_ID;
  const rootPermission: ReturnType<typeof usePermission> = usePermission(WORKSPACE_ROOT_ID, 'UpdateWorkspace');
  const ownPermission: ReturnType<typeof usePermission> = usePermission(workspaceId, 'UpdateWorkspace');
  const canEditWorkspace: boolean = permits(rootPermission) || permits(ownPermission);
  // The section CLAIMS administration (its header says Admin), so it waits for a known yes:
  // `confirms`, not `permits`, or every Guest would see it while their answer is on its way.
  // Either permission makes someone an administrator here: ManageRoles for people and roles,
  // EditWorkspaceConfig for the workspace's own settings. Each control inside keeps its own gate.
  const managesRoles: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, 'ManageRoles'));
  const configuresWorkspace: boolean = confirms(usePermission(WORKSPACE_ROOT_ID, 'EditWorkspaceConfig'));
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
      <AdminSettingsMenu
        canEditWorkspace={canEditWorkspace}
        offersBilling={billingSlug !== undefined}
        onWorkspaceSettings={() => setShowWorkspaceSettings(true)}
        onRolePermissions={() => setShowPermissionManager(true)}
        onBilling={() => setShowBilling(true)}
      />

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
          openSessionPortal={() => WorkspaceService.openBillingPortal()}
        />
      )}
    </>
  );
};
