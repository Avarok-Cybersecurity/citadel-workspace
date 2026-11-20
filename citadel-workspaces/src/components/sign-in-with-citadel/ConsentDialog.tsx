/**
 * The consent dialog of "Sign in with Citadel" (sign-in-with-citadel.md §8): a page dialog, never
 * `window.confirm`. It names the app and its client id, this device, the three match words in large
 * type, the identity signing in, and asks for the identity's unlock password, which the agent
 * re-proves for this one signature.
 */
import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explain } from '@/lib/sign-in-with-citadel/messages';
import { groupFingerprint } from '@/lib/sign-in-with-citadel/describe';

export interface ConsentDialogProps {
  displayName: string;
  clientId: string;
  device: string;
  words: readonly [string, string, string];
  idFp: string;
  busy: boolean;
  /** An agent refusal the person can answer here (`wrong_password`, `rate_limited`). */
  error: string | null;
  onApprove: (password: string) => void;
  onCancel: () => void;
}

export function ConsentDialog(props: ConsentDialogProps): JSX.Element {
  const { displayName, clientId, device, words, idFp, busy, error, onApprove, onCancel } = props;
  const [password, setPassword] = useState<string>('');
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (password.length > 0 && !busy) onApprove(password);
  };
  return (
    <Dialog open onOpenChange={(open: boolean): void => { if (!open && !busy) onCancel(); }}>
      <DialogContent data-testid="sign-in-consent" aria-describedby="sign-in-consent-warning" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in to {displayName}?</DialogTitle>
          <DialogDescription id="sign-in-consent-warning">
            Only approve if you started this sign-in yourself and the words match what {displayName} printed.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">App</dt>
          <dd className="break-words" data-testid="sign-in-consent-client">{displayName} <span className="text-muted-foreground">({clientId})</span></dd>
          <dt className="text-muted-foreground">Device</dt>
          <dd className="break-words" data-testid="sign-in-consent-device">{device}</dd>
        </dl>
        <section aria-labelledby="sign-in-match-title" className="rounded-md border border-border p-3">
          <h3 id="sign-in-match-title" className="mb-1 text-sm text-muted-foreground">Match words</h3>
          <ol className="flex flex-wrap gap-x-4 gap-y-1" data-testid="sign-in-match-words">
            {words.map((word: string, i: number) => (
              <li key={`${i}-${word}`} className="text-[28px] font-semibold leading-tight">{word}</li>
            ))}
          </ol>
        </section>
        <p className="text-sm" data-testid="sign-in-consent-identity">
          Signing in as <span className="whitespace-nowrap font-mono">{groupFingerprint(idFp)}</span>
        </p>
        <form onSubmit={submit} className="grid gap-2" noValidate>
          <Label htmlFor="sign-in-unlock-password">Your identity&apos;s unlock password</Label>
          <Input id="sign-in-unlock-password" type="password" autoComplete="current-password" value={password}
            onChange={(e): void => setPassword(e.target.value)} disabled={busy}
            aria-invalid={error === 'wrong_password' ? true : undefined}
            aria-describedby={error !== null ? 'sign-in-consent-error' : undefined} data-testid="sign-in-unlock-password" />
          {error !== null && (
            <p id="sign-in-consent-error" role="alert" className="text-sm text-destructive-emphasis" data-testid="sign-in-consent-error">
              {explain(error).body}
            </p>
          )}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy} data-testid="sign-in-cancel">Cancel</Button>
            <Button type="submit" disabled={busy || password.length === 0} aria-busy={busy} data-testid="sign-in-approve">
              {busy ? 'Signing in…' : 'Approve'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
