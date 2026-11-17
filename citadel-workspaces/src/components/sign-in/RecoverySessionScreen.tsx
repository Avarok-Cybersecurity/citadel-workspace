import { useEffect, useRef, useState } from 'react';
import { LifeBuoy, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { browserSignInDeps, manageSignIn } from '@/lib/sign-in';
import { keyFailureCopy, POLICY_COPY, SIGN_IN_COPY } from '@/lib/sign-in/copy';
import type { AccountRef, SignInPolicy, StepUp } from '@/lib/sign-in/types';
import { AddSecurityKeyCard } from './AddSecurityKeyCard';
import { PolicyChoice } from './PolicyChoice';

const ALL_POLICIES: readonly SignInPolicy[] = ['Password', 'PasswordAndKey', 'KeyOnly'];
/** A recovery session proves nothing further: the server allows it these two changes and no others. */
const RECOVERY_STEP_UP: StepUp = { password: null, security_key: true };

/**
 * Where a recovery-code sign-in lands. The session can add a key, set the
 * policy and sign out -- the agent and the server refuse everything else -- so
 * this offers exactly those, and never opens the workspace.
 */
export function RecoverySessionScreen({ account, signOut }: {
  account: AccountRef;
  /** Ends the restricted session and returns to the sign-in form. */
  signOut: () => Promise<void>;
}): JSX.Element {
  const [added, setAdded] = useState<boolean>(false);
  const [policy, setPolicy] = useState<SignInPolicy>('Password');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const savePolicy = (): void => {
    setBusy(true);
    setStatus(null);
    manageSignIn(browserSignInDeps().send, account.cid, { SetSignInPolicy: { policy } }, RECOVERY_STEP_UP)
      .then((): void => setStatus(`Saved: ${POLICY_COPY[policy].label}.`))
      .catch((error: unknown): void => setStatus(keyFailureCopy(error)))
      .finally((): void => setBusy(false));
  };
  const leave = (): void => {
    setBusy(true);
    signOut().catch((error: unknown): void => { setStatus(keyFailureCopy(error)); setBusy(false); });
  };

  return (
    <section className="space-y-5" data-testid="recovery-session" aria-labelledby="recovery-session-title">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-5 w-5 text-primary-accent" aria-hidden="true" />
        <h2 id="recovery-session-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
          {SIGN_IN_COPY.recoveryTitle}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{SIGN_IN_COPY.recoveryBody}</p>
      {added ? (
        <p role="status" className="text-sm" data-testid="recovery-key-added">Your new key is set up. Sign out, then sign in with it.</p>
      ) : (
        <AddSecurityKeyCard
          account={account} stepUp={RECOVERY_STEP_UP} title={SIGN_IN_COPY.addKeyTitle} body={SIGN_IN_COPY.addKeyBody}
          onFinished={(ok: boolean) => { if (ok) setAdded(true); }}
        />
      )}
      <div className="space-y-2 p-3 rounded-lg bg-background/50">
        <p className="text-sm font-medium">{SIGN_IN_COPY.policyTitle}</p>
        <PolicyChoice id="recovery" value={policy} options={ALL_POLICIES} onChange={setPolicy} disabled={busy} />
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={savePolicy} data-testid="recovery-save-policy">Save</Button>
      </div>
      {status && <p role="status" className="text-sm text-muted-foreground" data-testid="recovery-status">{status}</p>}
      <Button type="button" variant="secondary" className="w-full gap-2" disabled={busy} onClick={leave} data-testid="recovery-sign-out">
        <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
      </Button>
    </section>
  );
}
