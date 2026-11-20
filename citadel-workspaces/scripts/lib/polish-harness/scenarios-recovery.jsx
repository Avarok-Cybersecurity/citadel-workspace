/**
 * Account recovery's surfaces, as the sign-in dialog shows them (components/recovery/LoginRecovery.tsx
 * frames each in its Card): the phrase shown once and its three-word check, "Recover account" with a
 * long username and server and a mistyped word already left, and the recovery console on its welcome
 * (devices signed out), task list and set-password steps. The console's `send` never answers: these
 * scenarios measure layout, not the agent.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RecoveryPhrasePanel } from '@/components/recovery/RecoveryPhrasePanel';
import { RecoverAccountForm } from '@/components/recovery/RecoverAccountForm';
import { RecoveryConsole } from '@/components/recovery/RecoveryConsole';
import { getDefaultSecuritySettings } from '@/lib/security-utils';

export const PHRASE = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
  'account', 'accuse', 'achieve', 'acid', 'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'zoo'];
const NOOP = () => {};
const NEVER = () => new Promise(() => {});
const ACCOUNT = { tenant: 'acme-research-and-development-laboratories.work.avarok.net', cid: 7n, username: 'margaret.hamilton.apollo' };

/** LoginRecoveryCard's frame: the sign-in dialog's card. */
function Frame({ children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Sign in" className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
      <Card className="bg-background border-border shadow-2xl shadow-black/40 w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto" data-testid="recovery-card">
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  );
}

const Phrase = () => <Frame><RecoveryPhrasePanel secret={{ kind: 'phrase', words: PHRASE }} account={ACCOUNT.username} server={ACCOUNT.tenant} onDone={NOOP} /></Frame>;

/** The check step: the panel itself, moved on by its own button. */
function PhraseCheck() {
  useEffect(() => { document.querySelector('[data-testid="recovery-phrase-written"]')?.click(); }, []);
  return <Phrase />;
}

/** The form with a mistyped fifth word, left (blurred), so its error state is drawn. */
function Recover() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const cell = document.getElementById('recovery-word-4');
    if (cell === null) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(cell, 'abandx');
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.focus();
    cell.blur();
    setReady(true);
  }, []);
  return (
    <Frame>
      <div data-ready={ready ? 'true' : undefined} data-testid="recover-scenario">
        <RecoverAccountForm initialUsername={'margaret.hamilton.apollo.flight.software'} initialServer={`${ACCOUNT.tenant}:12400`}
          securitySettings={getDefaultSecuritySettings()} onRecovered={NOOP} onCancel={NOOP} />
      </div>
    </Frame>
  );
}

/** The console, driven to `view` by its own buttons. */
function Console({ view }) {
  useEffect(() => {
    const click = (id) => document.querySelector(`[data-testid="${id}"]`)?.click();
    if (view !== 'welcome') click('recovery-console-begin');
    if (view === 'password') setTimeout(() => click('recovery-task-password'), 0);
  }, [view]);
  return (
    <Frame>
      <RecoveryConsole account={ACCOUNT} serverAddress={ACCOUNT.tenant} devicesSignedOut send={NEVER} signOut={NEVER} signInWith={NEVER} />
    </Frame>
  );
}

export const RECOVERY_SCENARIOS = {
  'recovery-phrase': Phrase,
  'recovery-phrase-check': PhraseCheck,
  'recover-account': Recover,
  'recovery-console-welcome': () => <Console view="welcome" />,
  'recovery-console-tasks': () => <Console view="tasks" />,
  'recovery-console-password': () => <Console view="password" />,
};
