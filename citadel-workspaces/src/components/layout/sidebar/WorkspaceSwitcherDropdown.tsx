import { LogIn, Plus, Server, Settings, Shield } from "lucide-react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { StoredWorkspace } from "./useWorkspaceSwitcher";
import { MemberAvatar } from '@/components/shared/MemberAvatar';

interface WorkspaceSwitcherDropdownProps {
  availableWorkspaces: StoredWorkspace[];
  currentWorkspace: StoredWorkspace | null;
  isSwitching: boolean;
  onWorkspaceChange: (workspace: StoredWorkspace) => void;
  onAddAccountToWorkspace: (workspaceName: string, serverAddress: string) => void;
  onAddWorkspace: () => void;
  onManageAccounts: () => void;
}

export function WorkspaceSwitcherDropdown({
  availableWorkspaces,
  currentWorkspace,
  isSwitching,
  onWorkspaceChange,
  onAddAccountToWorkspace,
  onAddWorkspace,
  onManageAccounts,
}: WorkspaceSwitcherDropdownProps): JSX.Element {
  const groupedWorkspaces: [string, StoredWorkspace[]][] = Object.entries(
    availableWorkspaces
      .filter(workspace => workspace.id !== currentWorkspace?.id)
      .reduce((acc, workspace) => {
        // By server, not by name: two orgs can share a name (every hosted org was "Root Workspace").
        const key: string = workspace.serverAddress;
        if (!acc[key]) acc[key] = [];
        acc[key].push(workspace);
        return acc;
      }, {} as Record<string, StoredWorkspace[]>)
  );

  return (
    <DropdownMenuContent
      align="start"
      sideOffset={0}
      className="w-[var(--radix-dropdown-menu-trigger-width)] bg-background border border-border shadow-xl shadow-black/40 animate-slide-down"
      style={{ "--trigger-width": "var(--radix-dropdown-menu-trigger-width)" } as React.CSSProperties}
    >
      {groupedWorkspaces.map(([workspaceKey, workspaces]) => (
        <div key={workspaceKey} className="mb-1">
          <div className="px-3 py-1.5 text-xs text-muted-foreground font-semibold tracking-wider uppercase flex items-center justify-between">
            <span>{workspaces[0].workspaceName ?? workspaceKey}</span>
            <span className="text-muted-foreground normal-case tracking-normal font-normal">{workspaces[0].serverAddress}</span>
          </div>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => onWorkspaceChange(workspace)}
              className="flex items-center gap-3 py-2.5 min-h-[44px] cursor-pointer text-foreground w-full pl-3 group bg-transparent workspace-item-hover focus:bg-primary-accent/15 focus:text-foreground"
              disabled={isSwitching}
              // Not a one-click switch: the agent holds no session for it, so the click opens sign-in.
              aria-label={workspace.signedIn === false ? `Sign in to ${workspace.username} on ${workspace.serverAddress} (signed out)` : undefined}
              data-testid={workspace.signedIn === false ? 'switcher-account-signed-out' : undefined}
            >
              <MemberAvatar username={workspace.username} name={workspace.fullName || workspace.username} className={workspace.signedIn === false ? "h-8 w-8 text-sm opacity-60" : "h-8 w-8 text-sm"} />
              <div className="flex-1 min-w-0">
                <span className="font-semibold block text-sm truncate">
                  {workspace.fullName || workspace.username}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                  <span className="truncate" data-testid="switcher-account-handle">@{workspace.username}{workspace.role ? ` · ${workspace.role}` : ''}</span>
                  {/* Persisted from the ManageRoles answer (use-persist-own-standing): another
                      account's permissions cannot be asked from here. */}
                  {workspace.administers && (
                    <span title="Administrator"><Shield className="w-3 h-3 text-warning-emphasis" /></span>
                  )}
                </span>
              </div>
              {workspace.signedIn === false && <SignedOutTag />}
              {workspace.isActive && (
                <div className="w-2 h-2 bg-success rounded-full animate-pulse-glow flex-shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => onAddAccountToWorkspace(workspaces[0].workspaceName ?? workspaceKey, workspaces[0].serverAddress)}
            className="flex items-center gap-3 py-2 cursor-pointer text-muted-foreground w-full pl-8 group bg-transparent focus:bg-primary-accent/15 focus:text-foreground/80"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">Add another account</span>
          </DropdownMenuItem>
        </div>
      ))}
      <div className="border-t border-border">
        <DropdownMenuItem
          onClick={onAddWorkspace}
          className="flex items-center gap-3 py-2.5 cursor-pointer text-foreground w-full pl-3 group bg-transparent focus:bg-primary-accent/15 focus:text-foreground"
        >
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <Server className="w-5 h-5" />
          </div>
          <span className="font-semibold text-sm">Join New Workspace</span>
        </DropdownMenuItem>
        {availableWorkspaces.length > 0 && (
          <DropdownMenuItem
            onClick={onManageAccounts}
            className="flex items-center gap-3 py-2.5 cursor-pointer text-foreground/80 w-full pl-3 group bg-transparent focus:bg-primary-accent/15 focus:text-foreground"
          >
            <div className="w-8 h-8 rounded bg-card flex items-center justify-center">
              <Settings className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="font-semibold text-sm">Manage Accounts</span>
          </DropdownMenuItem>
        )}
      </div>
    </DropdownMenuContent>
  );
}

/** What a signed-out row offers instead of a switch, always visible (no hover-only control). */
function SignedOutTag(): JSX.Element {
  return (
    <span className="flex flex-shrink-0 flex-col items-end text-xs leading-tight" data-testid="switcher-account-signed-out-tag">
      <span className="text-muted-foreground">Signed out</span>
      <span className="flex items-center gap-1 font-medium text-primary-accent"><LogIn className="h-3 w-3" aria-hidden="true" />Sign in</span>
    </span>
  );
}
