/**
 * Account recovery's surfaces, as the sign-in dialog shows them (components/recovery/LoginRecovery.tsx
 * frames each in its Card): the phrase shown once and its three-word check, "Recover account" with a
 * long username and server and a mistyped word already left, the same form once a workspace has asked
 * for a human check, and the recovery console on its welcome (devices signed out), task list and
 * set-password steps. The console's `send` never answers: these scenarios measure layout, not the agent.
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
const SILENT_PORT = { send: NEVER, listen: () => NOOP };
/** Cloudflare's always-pass TEST site key: no real challenge is ever fetched here. */
const TEST_SITE_KEY = '1x00000000000000000000AA';
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

const Phrase = () => <Frame><RecoveryPhrasePanel words={PHRASE} account={ACCOUNT.username} server={ACCOUNT.tenant} onDone={NOOP} /></Frame>;

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
        <RecoverAccountForm port={SILENT_PORT} initialUsername={'margaret.hamilton.apollo.flight.software'} initialServer={`${ACCOUNT.tenant}:12400`}
          securitySettings={getDefaultSecuritySettings()} onRecovered={NOOP} onCancel={NOOP} />
      </div>
    </Frame>
  );
}

/** The agent as a workspace that checks answers a recovery with no token: refused, its check published. */
function checkingPort() {
  const handlers = new Set();
  return {
    send: async ({ RecoverAccount: body }) => {
      const refusal = { cid: 0n, request_id: body.request_id, message: 'A human check is required', reason_code: 'admission_required',
        admission_challenge: { provider: 'turnstile', site_key: TEST_SITE_KEY, identity: 'acme' } };
      setTimeout(() => handlers.forEach((h) => h({ RecoverAccountFailure: refusal })), 0);
    },
    listen: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
  };
}

/** Turnstile as the harness draws it: the real widget's 300x65 frame, never Cloudflare's script. */
const WIDGET_STAND_IN = {
  render(container) {
    const frame = document.createElement('div');
    frame.dataset.testid = 'turnstile-frame';
    frame.style.cssText = 'width:300px;height:65px;border:1px solid currentColor;border-radius:4px';
    container.appendChild(frame);
    return 'stand-in';
  },
  reset: NOOP,
  remove: NOOP,
};

/** The form after the workspace refused a recovery for want of a human check: the check drawn in it. */
function RecoverCheck() {
  const [port] = useState(checkingPort);
  useEffect(() => {
    window.turnstile = WIDGET_STAND_IN;
    // Pasted whole into the first box, as from the saved file: it fills all 24.
    const data = new DataTransfer();
    data.setData('text', PHRASE.join(' '));
    document.getElementById('recovery-word-0')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    setTimeout(() => document.querySelector('[data-testid="recover-submit"]')?.click(), 0);
  }, []);
  return (
    <Frame>
      <RecoverAccountForm port={port} initialUsername="margaret.hamilton.apollo" initialServer={ACCOUNT.tenant}
        securitySettings={getDefaultSecuritySettings()} onRecovered={NOOP} onCancel={NOOP} />
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
  'recover-account-check': RecoverCheck,
  'recovery-console-welcome': () => <Console view="welcome" />,
  'recovery-console-tasks': () => <Console view="tasks" />,
  'recovery-console-password': () => <Console view="password" />,
};
