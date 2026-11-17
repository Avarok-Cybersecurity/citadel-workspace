/**
 * "Open here too": the password (or a passkey) that lets this window join a
 * session another window holds, with both kept live (agent 0.8.6).
 *
 * Asked once per browser: the join earns a token that is kept sealed
 * (lib/sessions/join-token.ts), so the next time this browser opens the
 * session it joins without asking. "Move it here instead" is the older
 * takeover, for a user who wants the other window to stop.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { describeFailure } from '@/lib/failure-message';
import { browserOpenHereToo, openHereToo, type OpenHereTooDeps } from '@/lib/sessions/open-here-too';
import { browserPasskeyDeps, hasPasskeyLogin, passkeysAvailableHere, signInWithPasskey, failureOf } from '@/lib/passkey';
import { failureCopy } from '@/lib/passkey/copy';

export interface OpenHereTooProps {
  username: string;
  onClose: () => void;
  /** The older path: sign in and move the session here, closing it elsewhere. */
  onMoveInstead: () => void;
}

export function OpenHereToo({ username, onClose, onMoveInstead }: OpenHereTooProps): JSX.Element {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const confirm: ReturnType<typeof useConfirm> = useConfirm();
  const [password, setPassword] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [passkey, setPasskey] = useState<boolean>(false);
  const { ref, dialogProps } = useDialogOverlay({ label: `Open ${username} here too`, onDismiss: onClose });

  useEffect(() => {
    if (!passkeysAvailableHere()) return undefined;
    let live: boolean = true;
    const deps: ReturnType<typeof browserPasskeyDeps> = browserPasskeyDeps();
    hasPasskeyLogin(deps.store, deps.rpId, username).then((has: boolean) => { if (live) setPasskey(has); }, () => undefined);
    return (): void => { live = false; };
  }, [username]);

  // A passkey's own failures are already said in its words; anything else is the agent's.
  const run = async (attempt: (deps: OpenHereTooDeps) => Promise<void>, passkeyAttempt: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await attempt(browserOpenHereToo({ navigate, toast, confirm, signInAs: onMoveInstead, signInAgain: onMoveInstead }));
      onClose();
    } catch (e: unknown) {
      setError(passkeyAttempt && failureOf(e) !== 'failed' ? failureCopy(failureOf(e)) : describeFailure(e, 'This window could not join the session.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run((deps) => openHereToo(deps, username, password), false);
  };
  const usePasskey = (): void => {
    void run((deps) => signInWithPasskey(browserPasskeyDeps(), username, (user: string, secret: string) => openHereToo(deps, user, secret)), true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" ref={ref} {...dialogProps} data-testid="open-here-too">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-foreground">Open {username} here too</h2>
          <p className="text-sm text-muted-foreground">
            The other window stays signed in. This browser is asked once; after that it joins on its own.
          </p>
        </div>
        {passkey && (
          <Button type="button" className="w-full" disabled={busy} onClick={usePasskey} data-testid="open-here-too-passkey">
            Use a passkey
          </Button>
        )}
        <Input
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          data-testid="open-here-too-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onMoveInstead} disabled={busy}>Move it here instead</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || password.length === 0} data-testid="open-here-too-submit">Open here too</Button>
        </div>
      </form>
    </div>
  );
}
