/**
 * Session exit flows for the TopBar.
 *
 * Owns the two ways out of a workspace — Exit to Landing (session stays
 * active) and Sign Out (best-effort backend disconnect plus local cleanup) —
 * and the disconnect-modal state that narrates the second. Split from
 * TopBar.tsx so the bar renders chrome while the leave-the-app policy lives
 * here.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { mayLeaveEditor } from '@/lib/leave-editor';
import { useToast } from '@/hooks/use-toast';
import { toastSuccess } from '@/lib/toast-helpers';
import { connectionManager } from '@/lib/connection';
import { clearSelectedUser, getSelectedUser } from '@/lib/tab-context';
import { clearSignOutResidue } from '@/lib/sessions/sign-out-residue';
import { wasmConnectionManager } from '@/lib/wasm-connection-manager';
import type { DisconnectStatus } from '@/components/LoadingModal';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { describeError } from '@/lib/describe-error';
import type { NavigateFunction } from 'react-router';

export function useSessionExit(): { showDisconnectModal: boolean; disconnectStatus: DisconnectStatus; disconnectError: string | undefined; handleExit: () => Promise<void>; handleSignOut: () => Promise<void>; handleRetrySignOut: () => Promise<void>; handleDisconnectComplete: () => void; } {
  const { toast } = useToast();
  const navigate: NavigateFunction = useNavigate();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnectStatus, setDisconnectStatus] = useState<DisconnectStatus>("disconnecting");
  const [disconnectError, setDisconnectError] = useState<string | undefined>();

  const handleExit = async (): Promise<void> => {
    // Asked before the tab lets go of its session: the landing page unmounts
    // the editor, and an open document edit would go with it.
    if (!(await mayLeaveEditor(confirm))) return;

    // Stop WASM connection manager polling (session stays active but this tab won't poll)
    wasmConnectionManager.stop();

    // Just navigate to landing page, keep session active
    runAsyncSetup(clearSelectedUser);
    navigate('/');

    toastSuccess(toast, "Returned to landing page", "Your session is still active. Click your workspace icon to return instantly.");
  };

  const handleSignOut = async (): Promise<void> => {
    // Asked before anything is torn down: the landing page this ends on
    // unmounts the editor, and by then the session it would save to is gone.
    if (!(await mayLeaveEditor(confirm))) return;
    // Signing out deletes this account's documents from the device, edits not yet sent included.
    // A tab context that cannot be read is reported by the sign-out below, which reads it too.
    const leaving: bigint | null = await getSelectedUser().then((u) => u?.selectedCid ?? null, (): null => null);
    if (leaving !== null && !(await (await import('@/lib/document-save/held-edits-io')).mayLeaveAccountHeldEdits(leaving, true, confirm))) return;

    // Show the disconnect modal immediately
    setDisconnectStatus("disconnecting");
    setDisconnectError(undefined);
    setShowDisconnectModal(true);

    // Signed out means the AGENT let the session go: it is removed only by
    // Disconnect or Deregister, never by a timeout. So a failed Disconnect keeps
    // the stored session and says so (below), instead of claiming a sign-out
    // that did not happen.
    // Guarded, because the blocking modal is ALREADY on screen at this point.
    // Both of these reach IndexedDB, and getDB()'s `blocked` handler warns
    // without settling — so an older tab holding the previous schema version
    // leaves this await pending forever. Unguarded, the status then reaches
    // neither "ready" nor "error", and the z-[100] full-viewport overlay has
    // nothing clickable and no Escape: the only way out of the app is a
    // reload. Same shape as useOrphanSessions, which already settles to
    // "error" and self-closes.
    let currentSession: Awaited<ReturnType<typeof connectionManager.getTabSelectedSession>> = null;
    let tabSelection: Awaited<ReturnType<typeof getSelectedUser>> = null;
    try {
      currentSession = await connectionManager.getTabSelectedSession();
      tabSelection = await getSelectedUser();
    } catch (error) {
      debugLog('TopBar', 'Could not read the stored session for sign-out:', error);
      setDisconnectError(error instanceof Error ? error.message : 'Could not read the stored session.');
      setDisconnectStatus("error");
      setTimeout(() => setShowDisconnectModal(false), 3000);
      return;
    }
    const cid: bigint | null = tabSelection?.selectedCid ?? currentSession?.cid ?? null;

    if (cid) {
      try {
        debugLog('TopBar', 'Fully signing out user', currentSession?.username, 'CID:', cid.toString());
        await connectionManager.disconnect({
          cid,
          username: currentSession?.username,
          serverAddress: currentSession?.serverAddress,
        });
      } catch (error) {
        debugLog('TopBar', 'Backend disconnect failed; the session stays signed in:', error);
        setDisconnectError(
          `Sign-out failed for ${currentSession?.username ?? 'this account'}: ${describeError(error)}. ` +
          'You are still signed in. Retry to sign out.',
        );
        setDisconnectStatus("error");
        return;
      }
    } else {
      debugLog('TopBar', 'No CID available for backend disconnect, skipping');
    }

    wasmConnectionManager.stop();
    setDisconnectStatus("cleaning");

    try {
      if (currentSession?.username && currentSession?.serverAddress) {
        await connectionManager.removeSession(currentSession.username, currentSession.serverAddress);
      }
      await clearSelectedUser();
    } catch (error) {
      debugLog('TopBar', 'Local sign-out cleanup raised, ignoring:', error);
    }

    // "Fully logged out" has to be true of the device, not just the session.
    // The transfer history and the per-peer first-seen keys named who this
    // account talked to and what it exchanged, and survived sign-out in
    // localStorage where anyone with devtools could read them.
    clearSignOutResidue();

    setDisconnectStatus("ready");
  };

  const handleDisconnectComplete = (): void => {
    setShowDisconnectModal(false);
    if (disconnectStatus === "ready") {
      navigate('/');
      toastSuccess(toast, "Signed out", "You have been fully logged out. You'll need to login again to access this workspace.");
    }
  };

  return {
    showDisconnectModal,
    disconnectStatus,
    disconnectError,
    handleExit,
    handleSignOut,
    handleRetrySignOut: handleSignOut,
    handleDisconnectComplete,
  };
}
