import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ChevronLeft, LifeBuoy, LogIn, LogOut, MonitorX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CONSOLE_COPY } from '@/lib/recovery/copy';
import {
  consoleReducer, endsSignedIn, openConsole, stageOf, CONSOLE_STAGES, type ConsoleStage, type ConsoleState, type ConsoleTask,
} from '@/lib/recovery/console-state';
import {
  listCredentials, RECOVERY_STEP_UP, removeCredential, setNewPassword, setPolicy, type ConsoleCredentials as Listed,
} from '@/lib/recovery/console-ops';
import type { Send } from '@/lib/sign-in/key-answer';
import { SIGN_IN_COPY, keyFailureCopy } from '@/lib/sign-in/copy';
import type { AccountRef, SignInPolicy } from '@/lib/sign-in/types';
import { AddSecurityKeyCard } from '@/components/sign-in/AddSecurityKeyCard';
import { ConsoleCredentials } from './ConsoleCredentials';
import { ConsolePhrase } from './ConsolePhrase';
import { ConsolePolicy } from './ConsolePolicy';
import { ConsoleSetPassword } from './ConsoleSetPassword';
import { ConsoleTaskList } from './ConsoleTaskList';

/**
 * The recovery console: where a sign-in with the recovery phrase lands, instead of the
 * workspace. A guided set of steps over the only changes the server allows such a session.
 */
export function RecoveryConsole({ account, serverAddress, devicesSignedOut, send, signOut, signInWith }: {
  account: AccountRef;
  serverAddress: string;
  devicesSignedOut: boolean;
  send: Send;
  /** Ends the console session and returns to the sign-in form. */
  signOut: () => Promise<void>;
  /** Ends the console session and signs in with the password it just set. */
  signInWith: (password: string) => Promise<void>;
}): JSX.Element {
  const [state, dispatch] = useReducer(consoleReducer, devicesSignedOut, openConsole);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  /** The password this console set, held only until the console signs in with it. */
  const newPassword: React.MutableRefObject<string | null> = useRef<string | null>(null);
  const headingRef: React.RefObject<HTMLHeadingElement> = useRef<HTMLHeadingElement>(null);
  useEffect((): void => { headingRef.current?.focus(); }, [state.view]);

  const cid: bigint = account.cid;
  const list: () => Promise<Listed> = useCallback((): Promise<Listed> => listCredentials(send, cid), [send, cid]);
  const completed = (task: ConsoleTask): void => dispatch({ type: 'completed', task });
  const leave = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    action().catch((e: unknown): void => { setError(keyFailureCopy(e)); setBusy(false); });
  };
  const stage: ConsoleStage = stageOf(state.view);

  return (
    <section className="space-y-5" data-testid="recovery-console" data-view={state.view} aria-labelledby="recovery-console-title">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 shrink-0 text-primary-accent" aria-hidden="true" />
          <h2 id="recovery-console-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
            {CONSOLE_COPY.title}
          </h2>
        </div>
        <p className="truncate text-xs text-muted-foreground" data-testid="recovery-console-account">{account.username} · {serverAddress}</p>
        <ol className="grid grid-cols-3 gap-1.5" aria-label="Recovery steps">
          {CONSOLE_STAGES.map((s: ConsoleStage, i: number) => (
            <li key={s} aria-current={s === stage ? 'step' : undefined}
              className={`rounded-md border px-2 py-1.5 text-center text-xs leading-tight ${s === stage ? 'border-primary-accent bg-primary-accent/10 font-semibold text-foreground' : 'border-border text-muted-foreground'}`}>
              <span className="sr-only">Step {i + 1}: </span>{s}
            </li>
          ))}
        </ol>
      </header>

      {state.view === 'welcome' && <Welcome state={state} onContinue={(): void => dispatch({ type: 'continue' })} />}
      {state.view === 'tasks' && <ConsoleTaskList done={state.done} onOpen={(task: ConsoleTask): void => dispatch({ type: 'open', task })} onFinish={(): void => dispatch({ type: 'finish' })} />}
      {state.view !== 'welcome' && state.view !== 'tasks' && state.view !== 'finish' && (
        <div className="space-y-4">
          <Button type="button" variant="ghost" size="sm" className="min-h-[44px] -ml-2 gap-1" onClick={(): void => dispatch({ type: 'back' })} data-testid="recovery-console-back">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />{CONSOLE_COPY.back}
          </Button>
          {state.view === 'password' && (
            <ConsoleSetPassword save={(p: string): Promise<void> => setNewPassword(send, cid, p)} onSet={(p: string): void => { newPassword.current = p; completed('password'); }} />
          )}
          {state.view === 'key' && (
            <AddSecurityKeyCard account={account} stepUp={RECOVERY_STEP_UP} title={SIGN_IN_COPY.addKeyTitle} body={SIGN_IN_COPY.addKeyBody}
              onFinished={(added: boolean): void => { if (added) completed('key'); else dispatch({ type: 'back' }); }} />
          )}
          {state.view === 'credentials' && <ConsoleCredentials list={list} remove={(id: number): Promise<void> => removeCredential(send, cid, id)} />}
          {state.view === 'policy' && (
            <ConsolePolicy list={list} save={(p: SignInPolicy): Promise<void> => setPolicy(send, cid, p)} onSaved={(): void => completed('policy')} />
          )}
          {state.view === 'phrase' && <ConsolePhrase send={send} account={account} serverAddress={serverAddress} onDone={(): void => completed('phrase')} />}
        </div>
      )}
      {state.view === 'finish' && (
        <div className="space-y-3" data-testid="recovery-console-finish">
          <h3 className="text-base font-semibold">{CONSOLE_COPY.finishTitle}</h3>
          <p className="text-sm text-muted-foreground">{endsSignedIn(state) ? CONSOLE_COPY.finishSignedIn : CONSOLE_COPY.finishSignOut}</p>
          {endsSignedIn(state) && newPassword.current !== null ? (
            <Button type="button" className="w-full min-h-[44px] gap-2" disabled={busy} data-testid="recovery-console-continue"
              onClick={(): void => { const p: string | null = newPassword.current; if (p !== null) leave((): Promise<void> => signInWith(p)); }}>
              <LogIn className="h-4 w-4" aria-hidden="true" />{CONSOLE_COPY.continueSignedIn}
            </Button>
          ) : null}
        </div>
      )}

      {error !== null && <p role="alert" className="text-sm text-destructive-emphasis" data-testid="recovery-console-error">{error}</p>}
      <Button type="button" variant={state.view === 'finish' && !endsSignedIn(state) ? 'default' : 'secondary'} className="w-full min-h-[44px] gap-2"
        disabled={busy} onClick={(): void => leave(signOut)} data-testid="recovery-console-sign-out">
        <LogOut className="h-4 w-4" aria-hidden="true" />{CONSOLE_COPY.signOut}
      </Button>
    </section>
  );
}

function Welcome({ state, onContinue }: { state: ConsoleState; onContinue: () => void }): JSX.Element {
  return (
    <div className="space-y-4" data-testid="recovery-console-welcome">
      <p className="text-sm text-muted-foreground">{CONSOLE_COPY.intro}</p>
      {state.devicesSignedOut && (
        <div role="note" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground" data-testid="recovery-console-devices-signed-out">
          <MonitorX className="h-4 w-4 shrink-0 mt-0.5 text-warning-emphasis" aria-hidden="true" />
          <span>{CONSOLE_COPY.devicesSignedOut}</span>
        </div>
      )}
      <Button type="button" className="w-full min-h-[44px]" onClick={onContinue} data-testid="recovery-console-begin">{CONSOLE_COPY.begin}</Button>
    </div>
  );
}
