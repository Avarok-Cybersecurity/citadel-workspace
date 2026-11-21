import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validatePassword } from '@/lib/credential-rules';
import { CONSOLE_COPY, TASK_COPY } from '@/lib/recovery/copy';
import { keyFailureCopy } from '@/lib/sign-in/copy';

/**
 * The console's "Set a new password": typed twice, checked against the same rule registration
 * uses, then set by the server with no step-up. `onSet` receives the password so the console can
 * sign in with it at the end; nothing here keeps it.
 */
export function ConsoleSetPassword({ save, onSet }: {
  save: (password: string) => Promise<void>;
  onSet: (password: string) => void;
}): JSX.Element {
  const [password, setPassword] = useState<string>('');
  const [again, setAgain] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const first: React.RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  useEffect((): void => { first.current?.focus(); }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const invalid: string | null = validatePassword(password);
    if (invalid !== null) { setError(invalid); first.current?.focus(); return; }
    if (password !== again) { setError(CONSOLE_COPY.passwordMismatch); document.getElementById('console-password-again')?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      await save(password);
      onSet(password);
    } catch (failure: unknown) {
      setError(keyFailureCopy(failure));
      setBusy(false);
    }
  };
  const describedBy: string | undefined = error !== null ? 'console-password-error' : undefined;

  return (
    <form onSubmit={(e: React.FormEvent): void => { void submit(e); }} noValidate className="space-y-4" data-testid="console-password">
      <h3 className="text-base font-semibold">{TASK_COPY.password.title}</h3>
      <p className="text-sm text-muted-foreground">{TASK_COPY.password.detail}</p>
      <div className="space-y-1.5">
        <Label htmlFor="console-password">{CONSOLE_COPY.newPassword}</Label>
        <Input id="console-password" ref={first} type="password" autoComplete="new-password" value={password} disabled={busy}
          className="min-h-[44px]" aria-invalid={error !== null ? true : undefined} aria-describedby={describedBy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { setPassword(e.target.value); setError(null); }} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="console-password-again">{CONSOLE_COPY.confirmPassword}</Label>
        <Input id="console-password-again" type="password" autoComplete="new-password" value={again} disabled={busy}
          className="min-h-[44px]" aria-invalid={error === CONSOLE_COPY.passwordMismatch ? true : undefined} aria-describedby={describedBy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { setAgain(e.target.value); setError(null); }} />
      </div>
      {error !== null && <p id="console-password-error" role="alert" className="text-sm text-destructive-emphasis">{error}</p>}
      <Button type="submit" className="w-full min-h-[44px] gap-2" disabled={busy || password === '' || again === ''} data-testid="console-password-save">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{CONSOLE_COPY.savePassword}
      </Button>
    </form>
  );
}
