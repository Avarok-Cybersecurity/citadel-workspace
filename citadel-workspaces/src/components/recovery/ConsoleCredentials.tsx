import { useEffect, useState } from 'react';
import { KeyRound, LifeBuoy, Lock, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CONSOLE_COPY, TASK_COPY } from '@/lib/recovery/copy';
import type { ConsoleCredentials as Listed } from '@/lib/recovery/console-ops';
import { keyFailureCopy, POLICY_COPY } from '@/lib/sign-in/copy';
import type { FactorKind, SignInCredential } from '@/lib/sign-in/types';

const KIND: Record<FactorKind, { label: string; icon: typeof Lock }> = {
  Password: { label: 'Password', icon: Lock },
  SecurityKey: { label: 'Security key', icon: KeyRound },
  RecoveryCode: { label: 'Recovery code', icon: LifeBuoy },
  RecoveryPhrase: { label: 'Recovery phrase', icon: LifeBuoy },
};

/** Only a lost key is removed here: the password and the phrase are replaced, not removed. */
const removable = (c: SignInCredential): boolean => c.kind === 'SecurityKey';

/**
 * The console's "Review sign-in methods": every factor the server holds, and Remove for a key that
 * is lost. The server refuses a removal that would leave the policy unsatisfiable, in its own words.
 */
export function ConsoleCredentials({ list, remove }: {
  list: () => Promise<Listed>;
  remove: (id: number) => Promise<void>;
}): JSX.Element {
  const [listed, setListed] = useState<Listed | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(true);

  useEffect((): (() => void) => {
    let live: boolean = true;
    list().then((l: Listed): void => { if (live) setListed(l); }, (e: unknown): void => { if (live) setStatus(keyFailureCopy(e)); })
      .finally((): void => { if (live) setBusy(false); });
    return (): void => { live = false; };
  }, [list]);

  const drop = (credential: SignInCredential): void => {
    setBusy(true);
    setStatus(null);
    remove(credential.id)
      .then((): void => {
        setListed((l: Listed | null) => (l ? { ...l, credentials: l.credentials.filter((c: SignInCredential) => c.id !== credential.id) } : l));
        setStatus(`Removed ${credential.label || 'the key'}.`);
      }, (e: unknown): void => setStatus(keyFailureCopy(e)))
      .finally((): void => setBusy(false));
  };

  return (
    <section className="space-y-3" data-testid="console-credentials" aria-labelledby="console-credentials-title">
      <h3 id="console-credentials-title" className="text-base font-semibold">{TASK_COPY.credentials.title}</h3>
      {listed === null && busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>}
      {listed !== null && (<>
        <p className="text-sm text-muted-foreground">Signing in asks for: <span className="font-medium text-foreground">{POLICY_COPY[listed.policy].label}</span></p>
        {listed.credentials.length === 0 ? <p className="text-sm">{CONSOLE_COPY.credentialsEmpty}</p> : (
          <ul className="space-y-2" aria-label="Sign-in methods">
            {listed.credentials.map((c: SignInCredential) => {
              const Icon: typeof Lock = KIND[c.kind].icon;
              return (
                <li key={c.id} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg bg-background/50 px-3 py-2" data-testid="console-credential">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.label || KIND[c.kind].label}</span>
                      <span className="block text-xs text-muted-foreground">{KIND[c.kind].label}{c.consumed ? ' · used' : ''}</span>
                    </span>
                  </span>
                  {removable(c) && (
                    <Button type="button" variant="outline" size="sm" className="min-h-[44px] shrink-0 gap-1.5" disabled={busy}
                      aria-label={`Remove ${c.label || 'this key'}`} onClick={(): void => drop(c)} data-testid="console-credential-remove">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />{CONSOLE_COPY.remove}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>)}
      <p role="status" className="text-sm text-muted-foreground" data-testid="console-credentials-status">{status ?? ''}</p>
    </section>
  );
}
