import { forgetSession, withoutForgotten } from '@/lib/sessions/forgotten-sessions';
import { syncSelectedSessionToWasm } from './sync-selected-session-to-wasm';
import { useState, useCallback } from "react";
import type { UseOrphanSessionsResult } from './useOrphanSessions-types';
import { useAttentionGlow } from './use-attention-glow';
import { withWorkspaceNames } from '@/lib/sessions/with-workspace';
import { readLastAccessed } from '@/lib/sessions/last-accessed';
import { switchToSession } from '@/lib/sessions/switch-to-session';
import { heldElsewhereSignIn, type SignInRequest } from '@/lib/sessions/sign-in-request';
import { useNavigate } from "react-router-dom";
import { connectionManager } from "@/lib/connection";
import { websocketService } from "@/lib/websocket-service";
import type { ActiveSession, StoredSessions } from "@/types/session-types";
import type { DisconnectAction } from "./DisconnectConfirmModal";
import type { DisconnectStatus } from "./LoadingModal";
import { useToast } from "@/hooks/use-toast";
import { useEventListener } from "@/hooks/use-event-listener";
import { wasmConnectionManager } from "@/lib/wasm-connection-manager";
import { notificationService, type UnreadCountChange } from "@/lib/notification-service";
import { serverAutoConnectService } from "@/lib/server-auto-connect-service";
import { SESSION_CLAIMED } from '@/lib/multi-instance/claim-relay';
import { debugLog } from '@/lib/debug-config';
import { endedElsewhere, type SessionEnded } from '@/lib/sessions/session-ended';
import type { NavigateFunction } from 'react-router';
import { signOutSession, type SignOutResult, type SignOutTarget } from './sign-out-session';
import { useConfirm } from './shared/confirm-dialog';

export interface OrphanSessionWithWorkspace extends ActiveSession {
  workspaceName: string;
  storedSessionIndex: number;
  lastAccessed?: number;
}

export function useOrphanSessions(): UseOrphanSessionsResult {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const [signInRequest, setSignInRequest] = useState<SignInRequest | null>(null);
  const [sessions, setSessions] = useState<OrphanSessionWithWorkspace[]>([]);
  const [disconnectTarget, setDisconnectTarget] = useState<{
    session: ActiveSession;
    workspaceName: string;
  } | null>(null);
  const { glowing: glowingSessionCid, observe } = useAttentionGlow();
  const [notificationCounts, setNotificationCounts] = useState<Map<string, number>>(new Map());

  const [loadingModal, setLoadingModal] = useState<{
    open: boolean;
    status: DisconnectStatus;
    workspaceName: string;
    errorMessage?: string;
  }>({
    open: false,
    status: "disconnecting",
    workspaceName: "",
  });

  const loadActiveSessions: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      await connectionManager.waitForReady();
      const { ok, sessions: activeSessions } = await connectionManager.getActiveSessionsResult();
      // A query that was never answered is not the answer "no sessions". The
      // navbar renders nothing at zero, so treating a timeout as emptiness made
      // the Active Sessions strip disappear and the user log in again -- and
      // CIDs are permanent, so a stale list is strictly better than an empty
      // one here.
      if (!ok) return;
      const visibleSessions: typeof activeSessions = withoutForgotten(activeSessions);

      const storedSessions: StoredSessions = connectionManager.getStoredSessions();

      const sessionsWithWorkspace: OrphanSessionWithWorkspace[] = withWorkspaceNames(
        visibleSessions,
        storedSessions.sessions,
        readLastAccessed,
      );
      setSessions(sessionsWithWorkspace);

      await syncSelectedSessionToWasm(sessionsWithWorkspace);
    } catch (error) {
      // Keep whatever was last known good. Clearing here asserted "you have no
      // sessions" on the strength of a failure.
      debugLog('OrphanSessionsNavbar', 'Failed to load active sessions:', error);
    }
  }, []);

  const handleNavigate = (session: OrphanSessionWithWorkspace): Promise<void> =>
    switchToSession(session, {
      navigate, toast, confirm, signInAs: (username: string) => setSignInRequest(heldElsewhereSignIn(username)), signInAgain: setSignInRequest,
    });

  const handleDisconnect = (session: OrphanSessionWithWorkspace): void => {
    setDisconnectTarget({ session, workspaceName: session.workspaceName });
  };

  const handleConfirmDisconnect = async (action: DisconnectAction): Promise<void> => {
    if (!disconnectTarget) return;

    const workspaceName: string = disconnectTarget.workspaceName;
    const target: SignOutTarget = {
      cid: disconnectTarget.session.cid,
      username: disconnectTarget.session.username,
      serverAddress: disconnectTarget.session.server_address,
    };

    setDisconnectTarget(null);
    setLoadingModal({ open: true, status: "disconnecting", workspaceName });

    const result: SignOutResult = await signOutSession(
      {
        markUserDisconnected: (username, serverAddress) =>
          serverAutoConnectService.markUserDisconnected(username, serverAddress),
        currentWasmCid: () => wasmConnectionManager.getCurrentCid(),
        stopWasm: () => wasmConnectionManager.stop(),
        deregister: (cid) => websocketService.deregister(cid),
        disconnect: (cid) => websocketService.disconnect(cid),
        invalidateSessionCache: () => connectionManager.invalidateSessionCache(),
        removeSession: (username, serverAddress) =>
          connectionManager.removeSession(username, serverAddress),
        forget: (cid) => {
          // Both: the state now, and every list until the server agrees.
          forgetSession(cid);
          setSessions(prev => prev.filter(s => s.cid !== cid));
        },
        reload: () => loadActiveSessions(),
      },
      target,
      action,
      () => setLoadingModal(prev => ({ ...prev, status: "cleaning" })),
    );

    if (result.status === 'done') {
      setLoadingModal(prev => ({ ...prev, status: "ready" }));
      return;
    }

    setLoadingModal(prev => ({ ...prev, status: "error", errorMessage: result.message }));
    // A refusal is a decision the user can act on and stays until dismissed; a
    // failure is transient and clears itself, as it always has.
    if (result.status === 'failed') {
      setTimeout(() => { setLoadingModal(prev => ({ ...prev, open: false })); }, 3000);
    }
  };

  const handleLoadingComplete = (): void => {
    setLoadingModal(prev => ({ ...prev, open: false }));
  };

  // WebSocket connection success handler
  const handleWsConnectionSuccess: () => Promise<void> = useCallback(async (): Promise<void> => {
    debugLog('OrphanSessionsNavbar', 'WebSocket connected, reloading sessions...');
    await loadActiveSessions();
  }, [loadActiveSessions]);

  useEventListener('on-ws-connection-success', handleWsConnectionSuccess);
  // An account signed in, or a session claimed, in another window: its chip belongs here too.
  useEventListener('instance:registered', handleWsConnectionSuccess);
  useEventListener(SESSION_CLAIMED, handleWsConnectionSuccess);

  // An account signed out or deleted in another window ends its session here
  // too (lib/sessions/session-ended.ts); its chip must not outlive it.
  useEventListener('websocket-message', (message: unknown): void => {
    const ended: SessionEnded | null = endedElsewhere(message);
    if (!ended) return;
    forgetSession(ended.cid);
    setSessions(prev => prev.filter(s => s.cid !== ended.cid));
  });

  // Notification count handler
  const handleUnreadCountChanged: (change: UnreadCountChange) => void = useCallback((change: UnreadCountChange): void => {
    const next: Map<string, number> = new Map(change.byCid);
    setNotificationCounts(next);
    // The glow the chip was built for, and which nothing used to start.
    observe(next);
  }, [observe]);

  useEventListener<UnreadCountChange>('unread-count-changed', handleUnreadCountChanged);

  return {
    signInRequest,
    clearTakeover: (): void => setSignInRequest(null),
    sessions,
    disconnectTarget,
    setDisconnectTarget,
    glowingSessionCid,
    notificationCounts,
    loadingModal,
    loadActiveSessions,
    handleNavigate,
    handleDisconnect,
    handleConfirmDisconnect,
    handleLoadingComplete,
    notificationService,
  };
}
