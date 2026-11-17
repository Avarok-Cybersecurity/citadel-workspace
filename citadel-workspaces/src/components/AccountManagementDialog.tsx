import React, { useState, useEffect } from 'react';
import { useLiveSessions, LiveStatusUnknown, type LiveSessions } from './account-live-status';
import { useSavedAccounts, SavedAccountsLoading, SavedAccountsUnreadable, type SavedAccounts } from './account-saved-list';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { connectionManager } from '@/lib/connection';
import { Clock, Wifi } from 'lucide-react';
import type { ActiveSession, StoredSession } from '@/types/session-types';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { DeleteConfirmDialog, ClearAllConfirmDialog } from './AccountConfirmDialogs';
import type { NavigateFunction } from 'react-router';
import { sessionIsOnServer } from '@/lib/sessions/same-server';
import { accountHost, isCurrentAccount } from '@/lib/sessions/account-display';
import { switchToSession } from '@/lib/sessions/switch-to-session';
import { heldElsewhereSignIn, signedOutSignIn, type SignInRequest } from '@/lib/sessions/sign-in-request';
import { withWorkspaceNames } from '@/lib/sessions/with-workspace';
import { readLastAccessed } from '@/lib/sessions/last-accessed';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import type { TabIdentity } from '@/lib/tab-identity';
import { useConfirm } from './shared/confirm-dialog';
import { LazyTakeoverSignIn as TakeoverSignIn } from './LazyTakeoverSignIn';
import { AccountRow } from './AccountRows';
import { signedOutReasonFor } from './signed-out/signed-out-match';

interface AccountManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Put focus back where it was. Called once the content has closed. */
  onRestoreFocus?: () => void;
}

export function AccountManagementDialog({ isOpen, onClose, onRestoreFocus }: AccountManagementDialogProps): JSX.Element {
  const { toast } = useToast();
  const navigate: NavigateFunction = useNavigate();
  const saved: SavedAccounts = useSavedAccounts();
  const storedSessions: StoredSession[] = saved.sessions;
  const loadSaved: () => Promise<void> = saved.load;
  const [liveAsked, setLiveAsked] = useState(false);
  const live: LiveSessions = useLiveSessions();
  const loadLive: () => Promise<void> = live.load;
  const activeSessions: ActiveSession[] | null = live.sessions;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<{ username: string; serverAddress: string } | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);

  // This tab's account, not the global connection's, which names nobody in a resumed tab.
  const me: TabIdentity | null = useTabIdentity();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const [signIn, setSignIn] = useState<SignInRequest | null>(null);

  useEffect(() => {
    if (isOpen) {
      const loadActiveSessions = async (): Promise<void> => {
        try {
          await loadLive();
        } catch (error) {
          debugLog('AccountManagementDialog', 'Failed to load active sessions:', error);
        }
        setLiveAsked(true);
      };
      runAsyncSetup(loadActiveSessions);
      runAsyncSetup(loadSaved);
    }
  }, [isOpen, loadLive, loadSaved]);

  const handleRemoveSession = async (): Promise<void> => {
    if (!sessionToDelete) return;
    try {
      await connectionManager.removeSession(sessionToDelete.username, sessionToDelete.serverAddress);
      saved.sync();
      toast({ title: 'Account removed', description: `${sessionToDelete.username} has been removed from saved accounts.` });
      setDeleteConfirmOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      toast({ title: 'Failed to remove account', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleClearAll = async (): Promise<void> => {
    try {
      await connectionManager.removeAllSessions();
      saved.sync();
      toast({ title: 'Saved accounts cleared', description: 'The saved list is empty. Accounts signed in now stay signed in.' });
      setClearAllConfirmOpen(false);
      onClose();
    } catch (error) {
      toast({ title: 'Failed to clear accounts', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  // Not live in the agent: nothing to join or move, only a sign-in (the takeover's join answered "not found").
  const startSignIn = (username: string, serverAddress: string): void => { onClose(); setSignIn(signedOutSignIn(username, serverAddress)); };

  // The same claim sequence as the navbar and the switcher. This called
  // connectionManager.switchAccount, which reconnects with a SAVED password --
  // and passwords are no longer saved -- and never claimed anything, so a
  // session open in another browser window could not be switched to at all.
  const switchToLive = async (session: ActiveSession): Promise<void> => {
    const [target] = withWorkspaceNames([session], storedSessions, readLastAccessed);
    if (!target) return;
    onClose();
    await switchToSession(target, { navigate, toast, confirm, signInAs: (u: string) => setSignIn(heldElsewhereSignIn(u)), signInAgain: setSignIn });
  };

  const formatLastConnected = (timestamp?: number): string => {
    if (!timestamp) return 'Never';
    const diff: number = Date.now() - timestamp;
    const hours: number = Math.floor(diff / (1000 * 60 * 60));
    const days: number = Math.floor(hours / 24);
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'Recently';
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent
          className="sm:max-w-[600px] bg-card border-surface"
          // Radix's own close-autofocus lands on `<body>` here, because this
          // dialog has no `DialogTrigger` to return to -- the button that opens
          // it is an ordinary Button next door. Measured: closing with Escape or
          // with Close both left `document.activeElement` on the body, so a
          // keyboard user was dropped at the top of the document.
          //
          // Restored HERE rather than in the caller's `onClose`, because the
          // content stays mounted for its exit animation: a focus call made when
          // the dialog closes is undone ~300ms later when the content unmounts.
          // This event is the moment Radix itself would have moved focus, which
          // is exactly the moment that works.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus?.();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-foreground">Manage Accounts</DialogTitle>
            <DialogDescription className="text-foreground/80">
              Manage your saved workspace accounts and sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {(!liveAsked || saved.status === 'loading') && <SavedAccountsLoading />}
            {saved.status === 'unreadable' && <SavedAccountsUnreadable onRetry={() => { runAsyncSetup(loadSaved); }} />}
            {liveAsked && activeSessions === null && saved.status !== 'loading' && <LiveStatusUnknown />}
            {(activeSessions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-success-emphasis" />Active Sessions ({activeSessions?.length ?? 0})
                </h3>
                {(activeSessions ?? []).map((session) => (
                  <AccountRow
                    key={session.cid.toString()}
                    username={session.username}
                    host={accountHost(session, storedSessions)}
                    current={isCurrentAccount(me, session)}
                    live
                    lastConnected={null}
                    signedOut={null}
                    onSwitch={() => { void switchToLive(session); }}
                    onDelete={null}
                  />
                ))}
              </div>
            )}

            {storedSessions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />Saved Accounts ({storedSessions.length})
                </h3>
                {storedSessions.map((session) => {
                  const liveSession: ActiveSession | undefined =
                    activeSessions?.find(a => a.username === session.username && sessionIsOnServer(a, session.serverAddress));
                  return (
                    <AccountRow
                      key={`${session.username}-${session.serverAddress}`}
                      username={session.username}
                      host={session.serverAddress}
                      current={isCurrentAccount(me, { cid: session.cid, username: session.username })}
                      live={liveSession !== undefined}
                      lastConnected={session.lastConnected ? formatLastConnected(session.lastConnected) : null}
                      signedOut={liveSession === undefined ? signedOutReasonFor(session, live.signedOut) : null}
                      onSwitch={() => { if (liveSession) void switchToLive(liveSession); else startSignIn(session.username, session.serverAddress); }}
                      onDelete={() => { setSessionToDelete({ username: session.username, serverAddress: session.serverAddress }); setDeleteConfirmOpen(true); }}
                    />
                  );
                })}
              </div>
            )}

            {liveAsked && saved.status === 'ready' && (activeSessions?.length ?? 0) === 0 && storedSessions.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No accounts found. Join a workspace to get started.</p>
                <Button
                  variant="outline"
                  className="border-primary-accent text-primary-accent hover:bg-primary-accent/20"
                  onClick={() => {
                    onClose();
                    // Use a URL query param rather than a window event so the
                    // signal survives navigation timing (Landing's useEffect
                    // listener wouldn't be mounted yet if the dialog is opened
                    // from a non-landing route).
                    navigate('/?join=1');
                  }}
                >
                  Create Account
                </Button>
              </div>
            )}

            {storedSessions.length > 0 && (
              <div className="flex justify-end pt-4 border-t border-surface/50">
                <Button variant="destructive" onClick={() => setClearAllConfirmOpen(true)}>Clear Saved Accounts</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TakeoverSignIn request={signIn} onClose={() => setSignIn(null)} />
      <DeleteConfirmDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen} username={sessionToDelete?.username} onConfirm={handleRemoveSession} />
      <ClearAllConfirmDialog open={clearAllConfirmOpen} onOpenChange={setClearAllConfirmOpen} onConfirm={handleClearAll} />
    </>
  );
}
