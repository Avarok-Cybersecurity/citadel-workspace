/**
 * The sidebar's Admin rows, and "Plan & billing" as they open it. The dialog's session request is
 * refused (as the server refuses a member without EditWorkspaceConfig), so pressing "Manage
 * subscription" shows the claim-code form; no new tab is opened (`openTab` answers as a popup
 * blocker would) and the control plane is never reached: these scenarios measure layout.
 */
import { SidebarProvider } from '@/components/ui/sidebar';
import { AdminSettingsMenu } from '@/components/layout/sidebar/AdminSettingsMenu';
import { ManageSubscriptionDialog } from '@/components/layout/sidebar/ManageSubscriptionDialog';
import { createControlPlane } from '@/lib/onboarding/control-plane-client';

const NOOP = () => {};
const NEVER = () => new Promise(() => {});
const REFUSED = () => Promise.reject(new Error("Permission denied: EditWorkspaceConfig is required to manage this workspace's plan"));

export const BILLING_SCENARIOS = {
  'admin-settings-menu': () => (
    <SidebarProvider>
      <div className="w-64 bg-sidebar" data-testid="admin-settings-menu">
        <AdminSettingsMenu canEditWorkspace offersBilling onWorkspaceSettings={NOOP} onRolePermissions={NOOP} onBilling={NOOP} />
      </div>
    </SidebarProvider>
  ),
  'plan-and-billing': () => (
    <ManageSubscriptionDialog
      open onOpenChange={NOOP} slug="acme-research-and-development-laboratories"
      api={createControlPlane(NEVER, '/api')} openTab={() => null} openSessionPortal={REFUSED}
    />
  ),
};
