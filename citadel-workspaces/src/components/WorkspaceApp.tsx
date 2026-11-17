import React from 'react';
import { WorkspaceEventHandler } from './WorkspaceEventHandler';
import { ErrorDisplay } from './ui/error-display';
import { ProtocolWarning } from './ui/protocol-warning';
import { ConnectionRetryModal } from './ConnectionRetryModal';
import { PermissionsProvider } from '@/contexts/PermissionsContext';
import { websocketService } from '@/lib/websocket-service';
import { ConnectionService } from '@/lib/connection-service';
import { startGroupResponseService } from '@/lib/group-conversations/group-response-service';
import { useConnectionHandler } from './hooks';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { debugLog } from '@/lib/debug-config';
import { useAgentRequired } from '@/lib/onboarding/agent-optional';

/**
 * WorkspaceApp is the main container component that provides:
 * 1. Event handling and state management through WorkspaceEventHandler
 * 2. Error and warning notifications
 * 3. Global UI elements
 * 4. Centralized notification system
 */
export const WorkspaceApp: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    showConnectionRetry,
    connectionError,
    orphanSessionCid,
    setShowConnectionRetry,
  } = useConnectionHandler();

  const { isOnline } = useOnlineStatus();
  // False on the create-workspace flow, which talks only to the control plane
  // and is where a visitor without the agent is expected to be. See
  // lib/onboarding/agent-optional.ts.
  const agentRequired: boolean = useAgentRequired();

  // The translator from group responses to group:* events, started when the
  // workspace mounts. It used to be called ONLY inside the retry modal's
  // onRetry below — so in every session that never hit connection retry, no
  // group response was ever translated: creates, invites and member changes
  // all fell on the floor and the sidebar's group list stayed empty. The
  // retry-path call stays (the service is idempotent) so a listener is still
  // in place before a re-init.
  React.useEffect(() => {
    startGroupResponseService();
  }, []);

  return (
    <PermissionsProvider>
      <WorkspaceEventHandler>
        {children}

        <ErrorDisplay />
        <ProtocolWarning />

        {/* Not while the browser reports no network. OfflineBanner is already
            saying so across the top, and this dialog would sit on top of it
            telling the user to "check your internet connection" while counting
            down retries that cannot succeed — two notices for one condition,
            and the blocking one adds nothing. The retry state itself is
            untouched, so when connectivity returns the dialog reappears if the
            connection genuinely has not come back. */}
        <ConnectionRetryModal
          isOpen={showConnectionRetry && isOnline && agentRequired}
          onClose={() => setShowConnectionRetry(false)}
          errorMessage={connectionError || undefined}
          onRetry={async () => {
            if (orphanSessionCid) {
              try {
                await websocketService.setOrphanMode(true);
                const result: { cid?: bigint; } = await websocketService.claimSession(orphanSessionCid, true) as { cid?: bigint };
                if (result?.cid) {
                  ConnectionService.getInstance().updateConnectionStatus({
                    cid: result.cid,
                    isConnected: true
                  });
                  setShowConnectionRetry(false);
                  return;
                }
              } catch (error) {
                debugLog('WorkspaceApp', 'Failed to claim orphan session during retry:', error);
                throw error;
              }
            }
            // Group responses carry no request_id we track, so the listener has to
            // be in place before init or a GroupCreateSuccess arriving early is lost.
            startGroupResponseService();
            await websocketService.init();
          }}
        />
      </WorkspaceEventHandler>
    </PermissionsProvider>
  );
};

export default WorkspaceApp;
