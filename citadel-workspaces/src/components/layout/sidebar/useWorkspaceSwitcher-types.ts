/**
 * What `useWorkspaceSwitcher` returns.
 *
 * Its own module because the hook was 262 lines with it inline.
 */
import type { WorkspaceLogo } from '@/lib/workspace-metadata-service';
import type { Dispatch, SetStateAction } from 'react';
import type { StoredWorkspace } from './stored-workspace-list';
import type { WorkflowStep } from './useWorkspaceSwitcher';

export interface UseWorkspaceSwitcherResult {
  availableWorkspaces: StoredWorkspace[];
  currentWorkspace: StoredWorkspace | null;
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  isAddingWorkspace: boolean;
  setIsAddingWorkspace: Dispatch<SetStateAction<boolean>>;
  isManagingAccounts: boolean;
  setIsManagingAccounts: Dispatch<SetStateAction<boolean>>;
  currentStep: WorkflowStep;
  workspaceLogo: WorkspaceLogo;
  isSwitching: boolean;
  targetWorkspaceForNewAccount: { workspaceName: string; serverAddress: string } | null;
  setTargetWorkspaceForNewAccount: Dispatch<SetStateAction<{ workspaceName: string; serverAddress: string } | null>>;
  serverAddress: string;
  serverPassword: string;
  handleWorkspaceChange: (workspace: StoredWorkspace) => Promise<void>;
  handleAddWorkspace: () => void;
  handleAddAccountToWorkspace: (wsName: string, serverAddress: string) => void;
  handleManageAccounts: () => void;
  handleNext: (address?: string, password?: string) => void;
  handleBack: () => void;
}
