/**
 * "Role permissions": the workspace's roles and what each may do, everywhere in the workspace.
 *
 * The table is the server's, read live (hooks/use-workspace-roles): there is no copy of any
 * role's permissions in the UI. Until it arrives this says it is loading, never that there are
 * no roles; a failed read says so in the server's words and offers to ask again. Who may change
 * what is the ladder's (RoleEditor): anyone may read the table, and editing needs Manage roles.
 */
import React from 'react';
import { Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { retryRoles, useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import type { RolesState } from '@/lib/workspace-roles/roles-store';
import { RoleEditor } from './RoleEditor';

function Unloaded({ state, onClose }: { state: RolesState; onClose: () => void }): JSX.Element {
  return (
    <>
      {state.status === 'failed' ? (
        <div role="alert" className="flex-1 px-6 py-6 text-sm text-destructive-emphasis" data-testid="roles-failed">
          <p>The roles could not be read: {state.reason}</p>
          <Button variant="outline" onClick={retryRoles} className="mt-3 h-[36px] text-sm">Try again</Button>
        </div>
      ) : (
        <p role="status" className="flex flex-1 items-center gap-2 px-6 py-6 text-sm text-muted-foreground" data-testid="roles-loading">
          <Loader2 className="h-[16px] w-[16px] animate-spin" aria-hidden="true" /> Loading roles…
        </p>
      )}
      <div className="flex flex-shrink-0 justify-end border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onClose} className="h-[36px] text-sm">Close</Button>
      </div>
    </>
  );
}

export const PermissionManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const roles: RolesState = useWorkspaceRoles();
  return (
    <div className="bg-background border border-border rounded-xl shadow-2xl shadow-black/40 max-h-[85vh] min-w-0 flex flex-col overflow-hidden">
      <div className="px-6 py-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-accent/10 flex items-center justify-center">
            <Shield className="h-4.5 w-4.5 text-primary-accent" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Role permissions</h2>
            <p className="text-xs text-muted-foreground mt-0.5">What each role can do, everywhere in the workspace.</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-foreground/80" data-testid="role-permissions-how-to-change">
          To change what one person can do on top of their role, open their ⋯ menu in the member list and choose Manage Permissions.
        </p>
      </div>
      {roles.status === 'loaded' ? <RoleEditor table={roles.table} onClose={onClose} /> : <Unloaded state={roles} onClose={onClose} />}
    </div>
  );
};
