/**
 * The identity screens a new person needs before they can sign in (sign-in-with-citadel.md §8:
 * `IdentityCreate`, then the recovery-phrase confirmation): choose an unlock password, write the
 * 24 words down, type three of them back.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { explain } from '@/lib/sign-in-with-citadel/messages';

/** Below this an unlock password is refused here: it is all that guards the identity's sealed seed on this computer. */
export const MIN_UNLOCK_PASSWORD_CHARS: number = 8;

export function CreateIdentityForm({ busy, error, onCreate, onCancel }: {
  busy: boolean; error: string | null; onCreate: (password: string) => void; onCancel: () => void;
}): JSX.Element {
  const [password, setPassword] = useState<string>('');
  const [again, setAgain] = useState<string>('');
  const short: boolean = password.length < MIN_UNLOCK_PASSWORD_CHARS;
  const differs: boolean = again.length > 0 && again !== password;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!short && again === password && !busy) onCreate(password);
  };
  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="sign-in-create-identity" noValidate>
      <p className="text-sm text-muted-foreground">
        Your identity lives in the Citadel Agent on this computer. Choose a password to lock it; you will type it each time you sign in to an app.
      </p>
      <Label htmlFor="sign-in-new-password">Unlock password</Label>
      <Input id="sign-in-new-password" type="password" autoComplete="new-password" value={password} disabled={busy}
        onChange={(e): void => setPassword(e.target.value)} aria-describedby="sign-in-new-password-hint" />
      <p id="sign-in-new-password-hint" className="text-xs text-muted-foreground">At least {MIN_UNLOCK_PASSWORD_CHARS} characters.</p>
      <Label htmlFor="sign-in-new-password-again">Type it again</Label>
      <Input id="sign-in-new-password-again" type="password" autoComplete="new-password" value={again} disabled={busy}
        onChange={(e): void => setAgain(e.target.value)} aria-invalid={differs ? true : undefined}
        aria-describedby={differs ? 'sign-in-new-password-differs' : undefined} />
      {differs && <p id="sign-in-new-password-differs" className="text-sm text-destructive-emphasis">The two passwords differ.</p>}
      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{explain(error).body}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || short || again !== password} aria-busy={busy} data-testid="sign-in-create">
          {busy ? 'Creating…' : 'Create identity'}
        </Button>
      </div>
    </form>
  );
}

export function ConfirmPhrase({ phrase, checks, error, onConfirm, onCancel }: {
  phrase: readonly string[]; checks: readonly number[]; error: string | null;
  onConfirm: (answers: string[]) => void; onCancel: () => void;
}): JSX.Element {
  const [written, setWritten] = useState<boolean>(false);
  const [answers, setAnswers] = useState<string[]>(() => checks.map((): string => ''));
  if (!written) {
    return (
      <section className="grid gap-3" aria-labelledby="sign-in-phrase-title" data-testid="sign-in-recovery-phrase">
        <h2 id="sign-in-phrase-title" className="text-lg font-semibold">Write down your recovery phrase</h2>
        <p className="text-sm text-muted-foreground">
          These 24 words are the only way to get your identity back if this computer is lost. Write them on paper, in order, and keep them private.
        </p>
        <ol className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 font-mono text-sm sm:grid-cols-3">
          {phrase.map((word: string, i: number) => (
            <li key={`${i}-${word}`}><span className="text-muted-foreground">{i + 1}.</span> {word}</li>
          ))}
        </ol>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={(): void => setWritten(true)} data-testid="sign-in-phrase-written">I have written it down</Button>
        </div>
      </section>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onConfirm(answers);
  };
  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="sign-in-phrase-check" noValidate>
      <h2 className="text-lg font-semibold">Check your recovery phrase</h2>
      <p className="text-sm text-muted-foreground">Type these words from what you wrote down.</p>
      {checks.map((position: number, i: number) => (
        <div key={position} className="grid gap-1">
          <Label htmlFor={`sign-in-phrase-word-${position}`}>Word {position + 1}</Label>
          <Input id={`sign-in-phrase-word-${position}`} autoComplete="off" autoCapitalize="none" spellCheck={false} value={answers[i]}
            onChange={(e): void => setAnswers((prev: string[]) => prev.map((a: string, j: number) => (j === i ? e.target.value : a)))} />
        </div>
      ))}
      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={(): void => setWritten(false)}>Show the words again</Button>
        <Button type="submit" disabled={answers.some((a: string) => a.trim().length === 0)} data-testid="sign-in-phrase-confirm">Continue</Button>
      </div>
    </form>
  );
}
