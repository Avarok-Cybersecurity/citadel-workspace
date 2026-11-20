import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, LifeBuoy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveServerAddress } from '@/lib/address-resolver';
import { RECOVER_COPY } from '@/lib/recovery/copy';
import { emptyCells, readCells, readingError, type PhraseReading } from '@/lib/recovery/phrase-entry';
import { RECOVER_TIMEOUT_MS, recoverAccount, type RecoveryConsoleSession } from '@/lib/recovery/recover-account';
import { browserAgentPort } from '@/lib/recovery/recovery-ports';
import { describeFailure } from '@/lib/failure-message';
import type { SessionSecuritySettings } from '@/lib/security-utils';
import { defaultDeviceLabel } from '@/components/sign-in/default-key-label';
import { PhraseEntry } from './PhraseEntry';

export interface RecoveredAccount extends RecoveryConsoleSession {
  username: string;
  serverAddress: string;
}

type Field = 'recover-username' | 'recover-server' | 'recover-device' | 'recovery-word';

/**
 * "Recover account" on the sign-in screen: the username, its server, a name for this device and
 * the 24-word phrase. Each field is checked before anything is sent; the agent then recovers the
 * account and signs in to the recovery console.
 */
export function RecoverAccountForm({ initialUsername, initialServer, securitySettings, onRecovered, onCancel }: {
  initialUsername: string;
  initialServer: string;
  securitySettings: SessionSecuritySettings;
  onRecovered: (recovered: RecoveredAccount) => void;
  onCancel: () => void;
}): JSX.Element {
  const [username, setUsername] = useState<string>(initialUsername);
  const [server, setServer] = useState<string>(initialServer);
  const [device, setDevice] = useState<string>(() => defaultDeviceLabel(navigator.userAgent));
  const [cells, setCells] = useState<string[]>(emptyCells);
  const [error, setError] = useState<{ message: string; field: Field | null } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect((): void => { headingRef.current?.focus(); }, []);

  const refuse = (message: string, field: Field | null, focusId: string | null): void => {
    setError({ message, field });
    if (focusId !== null) document.getElementById(focusId)?.focus();
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (username.trim() === '') { refuse('Enter your username.', 'recover-username', 'recover-username'); return; }
    if (server.trim() === '') { refuse('Enter the workspace server your account is on.', 'recover-server', 'recover-server'); return; }
    if (device.trim() === '' || device.trim().length > 64) { refuse('Name this device in 1 to 64 characters.', 'recover-device', 'recover-device'); return; }
    const reading: PhraseReading = readCells(cells);
    if (reading.kind === 'incomplete') {
      const first: number = reading.wrong[0] ?? reading.missing[0];
      refuse(readingError(reading) ?? '', 'recovery-word', `recovery-word-${first}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const serverAddress: string = await resolveServerAddress(server);
      const session: RecoveryConsoleSession = await recoverAccount(browserAgentPort(), {
        username, serverAddress, phrase: reading.phrase, deviceLabel: device, admissionToken: null, securitySettings,
      }, crypto.randomUUID(), RECOVER_TIMEOUT_MS);
      onRecovered({ ...session, username: username.trim(), serverAddress });
    } catch (failure: unknown) {
      refuse(describeFailure(failure, 'The account could not be recovered. Check the phrase and try again.'), null, null);
      setBusy(false);
    }
  };

  const invalid = (field: Field): true | undefined => (error?.field === field ? true : undefined);
  const describe = (field: Field, hint?: string): string | undefined =>
    [hint, error?.field === field ? 'recover-error' : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <form onSubmit={(e: React.FormEvent): void => { void submit(e); }} noValidate className="space-y-4" data-testid="recover-account" aria-labelledby="recover-title">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Back to sign in" className="h-[44px] w-[44px] shrink-0" onClick={onCancel} disabled={busy}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <LifeBuoy className="h-5 w-5 shrink-0 text-primary-accent" aria-hidden="true" />
        <h2 id="recover-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">{RECOVER_COPY.title}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{RECOVER_COPY.body}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="recover-username">Username</Label>
          <Input id="recover-username" value={username} autoComplete="username" disabled={busy} className="min-h-[44px]"
            aria-invalid={invalid('recover-username')} aria-describedby={describe('recover-username')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { setUsername(e.target.value); setError(null); }} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recover-server">{RECOVER_COPY.server}</Label>
          <Input id="recover-server" value={server} autoComplete="off" spellCheck={false} disabled={busy} className="min-h-[44px]"
            placeholder="citadel.example.com:12400" aria-invalid={invalid('recover-server')} aria-describedby={describe('recover-server')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { setServer(e.target.value); setError(null); }} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{RECOVER_COPY.phrase}</legend>
        <p id="recover-phrase-hint" className="text-xs text-muted-foreground">{RECOVER_COPY.phraseHint}</p>
        <PhraseEntry cells={cells} disabled={busy} describedBy={describe('recovery-word', 'recover-phrase-hint') ?? 'recover-phrase-hint'}
          onChange={(next: string[]): void => { setCells(next); setError(null); }} />
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="recover-device">{RECOVER_COPY.device}</Label>
        <Input id="recover-device" value={device} maxLength={64} disabled={busy} className="min-h-[44px]"
          aria-invalid={invalid('recover-device')} aria-describedby={describe('recover-device', 'recover-device-hint')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => { setDevice(e.target.value); setError(null); }} />
        <p id="recover-device-hint" className="text-xs text-muted-foreground">{RECOVER_COPY.deviceHint}</p>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="recover-new-device-note">{RECOVER_COPY.newDevice}</p>
      {error !== null && (
        <p id="recover-error" role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive-emphasis" data-testid="recover-error">
          {error.message}
        </p>
      )}
      <Button type="submit" className="w-full min-h-[44px] gap-2" disabled={busy} data-testid="recover-submit">
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{RECOVER_COPY.working}</> : RECOVER_COPY.submit}
      </Button>
    </form>
  );
}
