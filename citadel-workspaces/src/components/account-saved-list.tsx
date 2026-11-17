import { useCallback, useState } from 'react';
import { connectionManager } from '@/lib/connection';
import { sessionsHaveBeenRead } from '@/lib/connection/sessions-read-state';
import { Button } from '@/components/ui/button';
import type { StoredSession } from '@/types/session-types';

/**
 * The saved accounts, and whether they have been read at all.
 *
 * The list lives in the agent and arrives asynchronously after the page loads.
 * The dialog copied `getStoredSessionsArray()` once, when it opened, so opening
 * it in the first second after load showed "No accounts found. Join a workspace
 * to get started." -- and kept showing it -- while three accounts were saved.
 * Reopening it showed them. A returning user was told, wrongly, that their
 * accounts were gone.
 *
 * So the list is read on open and awaited, and a read that failed is reported
 * as such (`sessionsHaveBeenRead`), not as an empty list. The same rule as
 * `useLiveSessions` beside it: unknown is not none.
 */
export type SavedListStatus = 'loading' | 'ready' | 'unreadable';

export interface SavedAccounts {
  sessions: StoredSession[];
  status: SavedListStatus;
  /** Read the list from the agent again. */
  load: () => Promise<void>;
  /** Take the in-memory list after a local change (remove, clear). */
  sync: () => void;
}

export function useSavedAccounts(): SavedAccounts {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [status, setStatus] = useState<SavedListStatus>('loading');

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    setStatus('loading');
    await connectionManager.reloadStoredSessions();
    setSessions(connectionManager.getStoredSessionsArray());
    setStatus(sessionsHaveBeenRead() ? 'ready' : 'unreadable');
  }, []);

  const sync: () => void = useCallback((): void => {
    setSessions(connectionManager.getStoredSessionsArray());
  }, []);

  return { sessions, status, load, sync };
}

export function SavedAccountsLoading(): JSX.Element {
  return (
    <p role="status" data-testid="saved-accounts-loading" className="text-center py-8 text-muted-foreground">
      Loading your accounts…
    </p>
  );
}

export function SavedAccountsUnreadable({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div role="status" data-testid="saved-accounts-unreadable" className="text-center py-6 space-y-3">
      <p className="text-muted-foreground">
        Your saved accounts could not be read from the Citadel Agent. They have not been deleted.
      </p>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}
