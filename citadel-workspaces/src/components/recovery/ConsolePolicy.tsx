import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CONSOLE_COPY, TASK_COPY } from '@/lib/recovery/copy';
import type { ConsoleCredentials } from '@/lib/recovery/console-ops';
import { keyFailureCopy, POLICY_COPY } from '@/lib/sign-in/copy';
import type { SignInPolicy } from '@/lib/sign-in/types';
import { PolicyChoice } from '@/components/sign-in/PolicyChoice';

const POLICIES: readonly SignInPolicy[] = ['Password', 'PasswordAndKey', 'KeyOnly'];

/** The console's "Change how you sign in": the current policy, read from the server, and Save. */
export function ConsolePolicy({ list, save, onSaved }: {
  list: () => Promise<ConsoleCredentials>;
  save: (policy: SignInPolicy) => Promise<void>;
  onSaved: () => void;
}): JSX.Element {
  const [policy, setPolicy] = useState<SignInPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(true);

  useEffect((): (() => void) => {
    let live: boolean = true;
    list().then((l: ConsoleCredentials): void => { if (live) setPolicy(l.policy); }, (e: unknown): void => { if (live) setError(keyFailureCopy(e)); })
      .finally((): void => { if (live) setBusy(false); });
    return (): void => { live = false; };
  }, [list]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (policy === null) return;
    setBusy(true);
    setError(null);
    save(policy).then(onSaved, (e: unknown): void => { setError(keyFailureCopy(e)); setBusy(false); });
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="console-policy-form">
      <h3 className="text-base font-semibold">{TASK_COPY.policy.title}</h3>
      <p className="text-sm text-muted-foreground">{TASK_COPY.policy.detail}</p>
      {policy === null
        ? busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>
        : <PolicyChoice id="console" value={policy} options={POLICIES} onChange={setPolicy} disabled={busy} />}
      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <Button type="submit" className="w-full min-h-[44px]" disabled={busy || policy === null} data-testid="console-policy-save">
        {policy === null ? CONSOLE_COPY.savePolicy : `${CONSOLE_COPY.savePolicy}: ${POLICY_COPY[policy].label}`}
      </Button>
    </form>
  );
}
