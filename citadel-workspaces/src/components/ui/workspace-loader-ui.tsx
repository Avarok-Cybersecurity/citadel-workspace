/**
 * Loading UI component for WorkspaceLoader.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';

interface WorkspaceLoaderSpinnerProps {
  loadingMessage: string;
  showConnectButton: boolean;
}

export const WorkspaceLoaderSpinner: React.FC<WorkspaceLoaderSpinnerProps> = ({
  loadingMessage,
  showConnectButton,
}) => {
  const navigate: NavigateFunction = useNavigate();

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background z-50">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-16 h-16 border-t-4 border-primary border-solid rounded-full animate-spin"></div>
        <div className="text-foreground text-lg font-medium">
          {loadingMessage}
        </div>
        {showConnectButton && (
          <button
            onClick={() => navigate('/connect')}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Go to Connect
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Shown instead of the workspace when the server has refused this account it (lib/membership-refusal.ts).
 * It said "Workspace data is taking longer than expected..." for ever, to a person no wait could help.
 */
export const WorkspaceRefusedNotice: React.FC = () => {
  const navigate: NavigateFunction = useNavigate();

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background z-50 px-4">
      <div role="alert" data-testid="workspace-refused" className="flex max-w-md flex-col items-center space-y-4 text-center">
        <div className="text-foreground text-lg font-medium">This account is not a member of this workspace</div>
        <p className="text-muted-foreground text-sm">
          An administrator removed it, so its spaces, chats and files are no longer open to it. Sign in with
          another account, or ask an administrator of this workspace to add this one back.
        </p>
        <button
          onClick={() => navigate('/connect')}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
        >
          Go to Connect
        </button>
      </div>
    </div>
  );
};
