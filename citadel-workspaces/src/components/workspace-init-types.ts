/**
 * Types for WorkspaceInitializationModal.
 */

export interface WorkspaceInitializationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  workspaceName?: string;
  workspaceId?: string;
  serverAddress?: string;
  username?: string;
  fullName?: string;
}
