/**
 * One row of the account manager: who, which workspace, and what can be done.
 *
 * The account in use is marked "Current" instead of being offered "Switch",
 * which from that row could only re-select what is already selected.
 */
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Trash2, Clock } from 'lucide-react';
import { SIGNED_OUT_COPY } from './signed-out/signed-out-copy';

interface AccountRowProps {
  username: string;
  host: string;
  current: boolean;
  live: boolean;
  lastConnected: string | null;
  /** Why the server signed this account out (GetSessions' `signed_out`); null when it did not. */
  signedOut: string | null;
  /** Switch to the account, or, when it is not live, sign in to it. */
  onSwitch: () => void;
  /** Absent for a live session with no saved account to delete. */
  onDelete: (() => void) | null;
}

function CurrentBadge(): JSX.Element {
  return <span className="text-xs text-primary-accent bg-primary-accent/15 px-2 py-0.5 rounded" data-testid="account-current">Current</span>;
}

export function AccountRow({ username, host, current, live, lastConnected, signedOut, onSwitch, onDelete }: AccountRowProps): JSX.Element {
  return (
    <div className={`flex items-center justify-between p-4 rounded-lg bg-background border ${live ? 'border-success/30' : 'border-surface/50'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <MemberAvatar username={username} name={username} className="h-10 w-10 text-sm" online={live} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-foreground font-medium truncate">{username}</h4>
            {current && <CurrentBadge />}
            {live && <span className="text-xs text-success-emphasis bg-success/20 px-2 py-0.5 rounded">Active</span>}
          </div>
          <p className="text-sm text-muted-foreground truncate">{host}</p>
          {signedOut !== null && (
            <div data-testid="account-signed-out">
              <p className="text-sm text-warning-emphasis">{SIGNED_OUT_COPY.status}</p>
              <p className="text-xs text-muted-foreground truncate" title={signedOut}>{signedOut}</p>
            </div>
          )}
          {lastConnected && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Clock className="h-3 w-3" />{lastConnected}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!current && (
          <Button variant="outline" size="sm" className="border-primary-accent text-primary-accent hover:bg-primary-accent/20" onClick={onSwitch}>{signedOut !== null ? SIGNED_OUT_COPY.signIn : 'Switch'}</Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" aria-label={`Delete saved account ${username} on ${host}`} className="text-destructive hover:bg-destructive/20" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
