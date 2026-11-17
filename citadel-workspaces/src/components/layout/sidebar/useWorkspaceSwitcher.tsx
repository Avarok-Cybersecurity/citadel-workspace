import { useState, useEffect, useCallback, useMemo } from "react";
import type { UseWorkspaceSwitcherResult } from './useWorkspaceSwitcher-types';
import { mayLeaveEditor } from '@/lib/leave-editor';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { switchToSession } from '@/lib/sessions/switch-to-session';
import { heldElsewhereSignIn, signedOutSignIn, type SignInRequest } from '@/lib/sessions/sign-in-request';
import { switcherWorkspaces, pickCurrentWorkspace, planSwitch, type StoredWorkspace, type SwitchPlan } from './stored-workspace-list';
import { describeFailure } from '@/lib/failure-message';
import { useNavigate } from "react-router-dom";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { connectionManager } from "@/lib/connection";
import { ConnectionService } from "@/lib/connection-service";
import { useToast } from "@/hooks/use-toast";
import { toastSuccess, toastError } from "@/lib/toast-helpers";
import { getSelectedUser, type TabUserContext } from "@/lib/tab-context";
import { getWorkspaceLogo , type WorkspaceLogo } from "@/lib/workspace-metadata-service";
import { workspaceLogoOf } from "@/lib/workspace-metadata/workspace-logo";
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { yieldToEventLoop } from '@/lib/utils/scheduling';
import { getWorkspacePath } from '@/lib/workspace-navigation';
import { useWorkspaceTheme } from '@/lib/theme/workspace-theme-context';

export type { StoredWorkspace } from './stored-workspace-list';
import type { NavigateFunction } from 'react-router';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import type { StoredSessions, StoredSession } from '@/types/session-types';

export type WorkflowStep = "connect" | "security" | "join";

export function useWorkspaceSwitcher(workspaceName: string | undefined, signIn: (request: SignInRequest) => void): UseWorkspaceSwitcherResult {
  const [availableWorkspaces, setAvailableWorkspaces] = useState<StoredWorkspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<StoredWorkspace | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingWorkspace, setIsAddingWorkspace] = useState(false);
  const [isManagingAccounts, setIsManagingAccounts] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("connect");
  const [isSwitching, setIsSwitching] = useState(false);
  const [targetWorkspaceForNewAccount, setTargetWorkspaceForNewAccount] = useState<{
    workspaceName: string;
    serverAddress: string;
  } | null>(null);
  // Server address and pre-shared key captured during the ServerConnect
  // step and forwarded into the Join step. Without this, Join (which
  // requires both as props) renders with `undefined` and the
  // registration call would fail downstream. Mirrors the equivalent
  // pattern in src/pages/Landing.tsx.
  const [serverAddress, setServerAddress] = useState<string>("");
  const [serverPassword, setServerPassword] = useState<string>("");
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const navigate: NavigateFunction = useNavigate();
  const { state } = useWorkspace();
  const { theme } = useWorkspaceTheme();
  const { toast } = useToast();

  const loadStoredWorkspaces: () => Promise<void> = useCallback(async (): Promise<void> => {
    const storedSessions: StoredSessions = connectionManager.getStoredSessions();
    const tabSelectedUser: TabUserContext | null = await getSelectedUser();
    const connInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
    // This tab's selection first: the connection's CID is whichever session connected last,
    // so after a switch it named the other org's account as current (measured live).
    const currentCid: bigint | null = tabSelectedUser?.selectedCid ?? connInfo?.cid ?? null;
    // The agent's live sessions too: a session resumed by claim is never saved, and the
    // switcher is how you reach another org (see switcherWorkspaces).
    const { ok, sessions: live } = await connectionManager.getActiveSessionsResult();
    const workspaces: StoredWorkspace[] = switcherWorkspaces(
      storedSessions?.sessions ?? [], ok ? live : null, state.workspace?.name, currentCid,
    );
    if (workspaces.length === 0) { setAvailableWorkspaces([]); return; }
    setAvailableWorkspaces(workspaces);

    const active: StoredWorkspace | undefined = pickCurrentWorkspace(workspaces, tabSelectedUser);
    if (active) setCurrentWorkspace(active);
  }, [state.workspace?.name]);

  useEffect(() => {
    runAsyncSetup(loadStoredWorkspaces);
    // Returning the unsubscribe drops the previous handler: it fixes the
    // per-remount leak (see onConnectionChange) and a stale `state.workspace`
    // closure whose late IndexedDB read could restore an old workspace name.
    return ConnectionService.getInstance().onConnectionChange(() => {
      void loadStoredWorkspaces();
    });
  }, [loadStoredWorkspaces]);

  // Opening the menu re-reads the stored list, so an account added in another tab is there without a reload.
  useEffect(() => {
    if (!isOpen) return;
    runAsyncSetup(async (): Promise<void> => {
      await connectionManager.reloadStoredSessions();
      await loadStoredWorkspaces();
    });
  }, [isOpen, loadStoredWorkspaces]);

  // The uploaded icon (metadata `logo`), else the theme's emoji, else initials. Derived, not
  // stored in state: a rename or a new icon broadcast re-renders it with nothing to keep in step.
  const logoName: string = state.workspace?.name ?? workspaceName ?? currentWorkspace?.username ?? 'W';
  const workspaceLogo: WorkspaceLogo = useMemo(
    (): WorkspaceLogo => getWorkspaceLogo(logoName, theme.icon, workspaceLogoOf(state.workspace?.metadata)),
    [logoName, theme.icon, state.workspace?.metadata],
  );

  const handleWorkspaceChange = async (workspace: StoredWorkspace): Promise<void> => {
    // Switching session tears the whole workspace down, editor included.
    if (!(await mayLeaveEditor(confirm))) return;

    if (isSwitching || workspace.id === currentWorkspace?.id) return;

    debugLog('WorkspaceSwitcher', 'Switching to workspace:', workspace.username, 'on', workspace.serverAddress);
    setIsSwitching(true);

    try {
      // Hand control back so the dropdown's spinner paints before the work below.
      await yieldToEventLoop();

      const storedSessions: StoredSessions = connectionManager.getStoredSessions();
      const targetSession: StoredSession | undefined = storedSessions.sessions.find(
        (s) => s.username === workspace.username && s.serverAddress === workspace.serverAddress
      );

      // The agent's list at the click decides: the row may have been read before a sign-out,
      // and a saved CID the agent does not hold is only ever refused ("Session <cid> not found").
      const { ok, sessions: live } = await connectionManager.getActiveSessionsResult();
      const plan: SwitchPlan = planSwitch(workspace, ok ? live : null, targetSession?.cid);
      if (plan.kind === 'sign-in') { signIn(signedOutSignIn(workspace.username, workspace.serverAddress)); return; }
      if (plan.kind === 'no-cid') throw new Error('Session CID not available');
      const cid: bigint = plan.cid;

      // The one switch sequence (lib/sessions/switch-to-session.ts). This hook
      // carried its own copy, which never set the instance CID nor announced
      // the activation: switching to a second account held by this very
      // browser claimed it ("not orphaned", so already ours), selected it, and
      // left every surface reading the old account -- nothing visibly happened.
      await switchToSession({
        cid,
        username: workspace.username,
        server_address: workspace.serverAddress,
        workspaceName: workspace.workspaceName ?? workspace.username,
        storedSessionIndex: targetSession ? storedSessions.sessions.indexOf(targetSession) : -1,
      }, { navigate, toast, confirm, signInAs: (u: string) => signIn(heldElsewhereSignIn(u)), signInAgain: signIn });
    } catch (error) {
      debugLog('WorkspaceSwitcher', 'Failed to switch workspace:', error);
      toastError(toast, "Switch Failed", describeFailure(error, "Could not switch to the selected workspace"));
    } finally {
      setIsSwitching(false);
      setIsOpen(false);
    }
  };

  const handleAddWorkspace = (): void => {
    setIsAddingWorkspace(true);
    setCurrentStep("connect");
    setTargetWorkspaceForNewAccount(null);
  };

  const handleAddAccountToWorkspace = (wsName: string, serverAddress: string): void => {
    setTargetWorkspaceForNewAccount({ workspaceName: wsName, serverAddress });
    setIsAddingWorkspace(true);
    setCurrentStep("connect");
    setIsOpen(false);
    toastSuccess(toast, "Adding New Account", `Join ${wsName} with a different account`);
  };

  const handleManageAccounts = (): void => {
    // Closing the menu WAS the entire handler. `AccountManagementDialog` had
    // exactly one mount in the app -- ManageAccountsButton, on the Landing page
    // -- so from inside a workspace this item closed the dropdown over an
    // unchanged screen and that was all it did.
    setIsOpen(false);
    setIsManagingAccounts(true);
  };

  // ServerConnect calls `onNext(address, password)`; SecuritySettings and
  // Join call `onNext()` (no args). Treat the args as optional so this
  // single handler can serve all three steps without reshaping their APIs.
  const handleNext = (address?: string, password?: string): void => {
    switch (currentStep) {
      case "connect":
        if (address !== undefined) setServerAddress(address);
        if (password !== undefined) setServerPassword(password);
        setCurrentStep("security");
        break;
      case "security": setCurrentStep("join"); break;
      case "join":
        // Reset captured server creds when the dialog closes so a
        // subsequent "Add a Workspace" doesn't reuse stale values.
        setIsAddingWorkspace(false);
        setCurrentStep("connect");
        setServerAddress("");
        setServerPassword("");
        setTargetWorkspaceForNewAccount(null);
        navigate(getWorkspacePath());
        break;
    }
  };

  const handleBack = (): void => {
    switch (currentStep) {
      case "security": setCurrentStep("connect"); break;
      case "join": setCurrentStep("security"); break;
    }
  };

  return {
    availableWorkspaces,
    currentWorkspace,
    isOpen,
    setIsOpen,
    isAddingWorkspace,
    setIsAddingWorkspace,
    isManagingAccounts,
    setIsManagingAccounts,
    currentStep,
    workspaceLogo,
    isSwitching,
    targetWorkspaceForNewAccount,
    setTargetWorkspaceForNewAccount,
    serverAddress,
    serverPassword,
    handleWorkspaceChange,
    handleAddWorkspace,
    handleAddAccountToWorkspace,
    handleManageAccounts,
    handleNext,
    handleBack,
  };
}
