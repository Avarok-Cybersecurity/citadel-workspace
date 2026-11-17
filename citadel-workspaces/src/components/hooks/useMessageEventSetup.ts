/**
 * useMessageEventSetup Hook
 *
 * Sets up event listeners for messages, typing indicators,
 * operation errors, and protocol warnings in WorkspaceEventHandler.
 */

import { useEffect } from 'react';
import { workspaceEvents, type ErrorPayload, type ConnectionInfo, type ProtocolWarningPayload, type MessagePayload } from '@/lib/workspace-events';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { isMembershipRefusal } from '@/lib/membership-refusal';
import type { WorkspaceEventState } from '../WorkspaceEventHandler';

interface UseMessageEventSetupOptions {
  setState: React.Dispatch<React.SetStateAction<WorkspaceEventState>>;
}

/**
 * The server reports a missing workspace here as free text, not as a variant.
 *
 * Mirrors `NetworkError::msg("No workspace found for user")` in
 * citadel-workspace-server-kernel/src/handlers/domain/server_ops/
 * async_domain_server_ops.rs. The protocol does have a structured
 * `WorkspaceProtocolResponse::WorkspaceNotInitialized`, and where that arrives it
 * is handled properly (see lib/workspace-response-handler/workspace-handlers.ts);
 * this path is the one place the condition only ever comes back as prose. Naming
 * it keeps the coupling greppable from both sides, so rewording the Rust string
 * breaks one visible constant rather than silently disabling first-run setup.
 */
const WORKSPACE_MISSING_ERROR: "No workspace found" = 'No workspace found';

export function useMessageEventSetup({ setState }: UseMessageEventSetupOptions): void {
  useEffect(() => {
    const setupMessageListeners = async (): Promise<void> => {
      await workspaceEvents.onMessageEvent('message:received', (payload: MessagePayload) => {
        debugLog('WorkspaceEventHandler', `Received message from peer: ${payload.peerCid}, length: ${payload.contentLength}`);
        if (!payload.contents) return;
        const peerCidStr: string = (payload.peerCid ?? 0n).toString();

        setState(prev => {
          const peerMessages: { content: string; timestamp: number; id?: string; pending?: boolean; }[] = prev.messages.byPeer[peerCidStr] || [];
          const updatedTypingPeerIds: string[] = prev.typing.peerIds.filter(id => id !== peerCidStr);
          return {
            ...prev,
            messages: {
              ...prev.messages,
              byPeer: {
                ...prev.messages.byPeer,
                [peerCidStr]: [...peerMessages, { content: payload.contents as string, timestamp: Date.now(), id: payload.connection.request_id }]
              },
              lastMessageTimestamp: Date.now()
            },
            typing: { ...prev.typing, peerIds: updatedTypingPeerIds, lastUpdated: Date.now() },
          };
        });
      });

      await workspaceEvents.onMessageEvent('typing:started', (payload: { peerCid: bigint, connection: ConnectionInfo }) => {
        const peerCidStr: string = payload.peerCid.toString();
        setState(prev => {
          if (!prev.typing.peerIds.includes(peerCidStr)) {
            return { ...prev, typing: { peerIds: [...prev.typing.peerIds, peerCidStr], lastUpdated: Date.now() } };
          }
          return prev;
        });
      });

      await workspaceEvents.onMessageEvent('typing:stopped', (payload: { peerCid: bigint, connection: ConnectionInfo }) => {
        const peerCidStr: string = payload.peerCid.toString();
        setState(prev => ({
          ...prev,
          typing: { peerIds: prev.typing.peerIds.filter(id => id !== peerCidStr), lastUpdated: Date.now() },
        }));
      });
    };

    const setupErrorHandling = async (): Promise<void> => {
      await workspaceEvents.onOperationEvent('operation:error', (payload: ErrorPayload) => {
        const needsInitialization: boolean = payload.message.includes(WORKSPACE_MISSING_ERROR);

        setState(prev => ({
          ...prev,
          error: payload.message,
          needsWorkspaceInitialization: needsInitialization,
          // Kept once said: until the workspace record arrives, nothing else here answers it.
          membershipRefused: prev.membershipRefused || isMembershipRefusal(payload.message),
        }));

        debugLog('WorkspaceEventHandler', 'Operation error:', payload.message);

        // Setting the flag is all that is needed: WorkspaceEventHandler has an
        // effect that opens the modal when it flips true. This used to also call
        // setShowInitModal(true) directly, which skipped that effect's
        // `!initModalDismissed` guard — so a user who closed the modal had it
        // forced back open by the next error of this kind, with no way to keep it
        // shut. One decision, one place.
        if (!needsInitialization) {
          setTimeout(() => { setState(prev => ({ ...prev, error: undefined })); }, 5000);
        }
      });

      await workspaceEvents.onOperationEvent('operation:success', (connectionInfo: ConnectionInfo) => {
        // Log only. This used to setState the request id into `lastRequestId`,
        // which nothing ever read — so every successful operation minted a new
        // root state object and re-rendered all 20 useWorkspace() subtrees for
        // a value with no consumer.
        debugLog('WorkspaceEventHandler', `Operation successful (CID: ${connectionInfo.cid}, request ID: ${connectionInfo.request_id})`);
      });
    };

    const setupProtocolWarningHandling = async (): Promise<void> => {
      await workspaceEvents.onProtocolEvent('protocol:warning', (payload: ProtocolWarningPayload) => {
        debugLog('WorkspaceEventHandler', `Protocol warning: ${payload.message}`);
        setState(prev => ({
          ...prev,
          protocolWarning: { message: payload.message, requestType: payload.requestType, timestamp: Date.now() },
        }));
        setTimeout(() => { setState(prev => ({ ...prev, protocolWarning: undefined })); }, 10000);
      });
    };

    const initializeEvents = async (): Promise<void> => {
      await setupMessageListeners();
      await setupErrorHandling();
      await setupProtocolWarningHandling();
      debugLog('WorkspaceEventHandler', 'Workspace event listeners initialized');
    };

    runAsyncSetup(initializeEvents);

    return (): void => {
      runAsyncSetup(async () => { workspaceEvents.cleanupAllListeners(); });
      p2pRegistrationService.stop();
    };
  }, [setState]);
}
