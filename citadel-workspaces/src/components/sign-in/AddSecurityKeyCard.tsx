import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PASSKEY_COPY } from '@/lib/passkey/copy';
import { browserSignInDeps } from '@/lib/sign-in';
import { keyFailureCopy, PRF_COPY, SIGN_IN_COPY } from '@/lib/sign-in/copy';
import { setUpSecurityKey, type KeyPolicy } from '@/lib/sign-in/set-up-key';
import { passkeysAvailableHere } from '@/lib/passkey';
import type { AccountRef, StepUp } from '@/lib/sign-in/types';
import { defaultPasskeyLabel } from './default-key-label';
import { PolicyChoice } from './PolicyChoice';

const KEY_POLICIES: readonly KeyPolicy[] = ['PasswordAndKey', 'KeyOnly'];

/**
 * "Add a security key": name it, choose how it is used, touch it twice (once to
 * make it, once for the server's enrolment challenge). Optional wherever it
 * appears, so "Not now" is always there.
 */
export function AddSecurityKeyCard({ account, stepUp, title, body, onFinished }: {
  account: AccountRef;
  /** What proves the account for this change: the password just used, or none in a recovery session. */
  stepUp: StepUp;
  title: string;
  body: string;
  /** true once the key is enrolled and the policy set. */
  onFinished: (added: boolean) => void;
}): JSX.Element {
  const [label, setLabel] = useState<string>(() => defaultPasskeyLabel(navigator.userAgent));
  const [policy, setPolicy] = useState<KeyPolicy>('PasswordAndKey');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  const webAuthn: boolean = passkeysAvailableHere();
  // Known only when the browser says so; until then, and when it cannot say, the ceremony decides.
  const [prfRuledOut, setPrfRuledOut] = useState<boolean>(false);
  const available: boolean = webAuthn && !prfRuledOut;
  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!webAuthn) return undefined;
    let live: boolean = true;
    browserSignInDeps().authenticator.prfRuledOut()
      .then((ruledOut: boolean): void => { if (live) setPrfRuledOut(ruledOut); }, (): void => undefined);
    return (): void => { live = false; };
  }, [webAuthn]);

  const add = (): void => {
    setBusy(true);
    setError(null);
    setUpSecurityKey(browserSignInDeps(), { account, label: label.trim(), policy, stepUp, existingCredentialIds: [] })
      .then((): void => onFinished(true))
      .catch((failure: unknown): void => setError(keyFailureCopy(failure)))
      .finally((): void => setBusy(false));
  };

  return (
    <section className="space-y-4" data-testid="add-security-key" aria-labelledby="add-security-key-title">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary-accent" aria-hidden="true" />
        <h2 id="add-security-key-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{body}</p>
      {!webAuthn ? (
        <p className="text-sm text-muted-foreground">{PASSKEY_COPY.unavailableHere}</p>
      ) : prfRuledOut ? (
        <p className="text-sm text-muted-foreground" data-testid="add-security-key-unsupported">{PRF_COPY.unavailableHere}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <label htmlFor="new-key-label" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">Name this key</label>
            <Input id="new-key-label" value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
          </div>
          <PolicyChoice id="new-key" value={policy} options={KEY_POLICIES} onChange={setPolicy} disabled={busy} />
          <p className="text-xs text-muted-foreground">{PASSKEY_COPY.pinNote}</p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive-emphasis" data-testid="add-security-key-error">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onFinished(false)} data-testid="add-security-key-skip">Not now</Button>
        {available && (
          <Button type="button" disabled={busy || !label.trim()} onClick={add} data-testid="add-security-key-continue" className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {SIGN_IN_COPY.addKeyTitle}
          </Button>
        )}
      </div>
    </section>
  );
}
