/**
 * Recovering an account on a workspace that asks for a human check (Cloudflare Turnstile).
 *
 * The recover form shows the sign-in form's own check (AdmissionCheck), under the `recover` action
 * the tenant worker verifies a recovery with, and sends its token as `RecoverAccount.admission_token`.
 * That token pays for the recovery; after a fresh recovery the phrase sign-in has none and may be
 * refused for its check, so the form asks again and re-sends RecoverAccount, now only a sign-in --
 * and the console must still say that every other device was signed out. The sign-in with the
 * console's new password is the form's own password sign-in, check included.
 *
 * Doubled at the I/O seams (login-world.ts): the agent, IndexedDB, the control-plane fetch for
 * discovery and Turnstile itself (fake-turnstile.ts, on Cloudflare's TEST site keys).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).connectionDouble(orig));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).tabContextDouble(orig));
vi.mock('@/lib/post-auth-setup', async () => ({ postAuthSetup: (await import('./login-world')).loginWorld.postAuth }));
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).passkeyDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));

import { Login } from '../Login';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

const SERVER: 'bench.work.avarok.net' = 'bench.work.avarok.net';
const NEW_PASSWORD: string = 'meadowlantern';
let onNext: Mock;
let alice: FakeAccount;
let turnstile: FakeTurnstile;

const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const type = (id: string, value: string): void => { fireEvent.change(field(id), { target: { value } }); };
const sentOf = (variant: string): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === variant).map(([, b]) => b);

/** Open "Recover account" and fill it, the server field left so the check binds to it. */
async function fillRecovery(): Promise<void> {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} /></MemoryRouter>);
  fireEvent.click(screen.getByTestId('login-recover-account'));
  await screen.findByTestId('recover-account');
  type('recover-username', 'alice');
  type('recover-server', SERVER);
  fireEvent.blur(field('recover-server'));
  fireEvent.paste(field('recovery-word-0'), { clipboardData: { getData: (): string => alice.phrase.join(' ') } });
}

/** Press Recover once the check has issued `tokens` tokens and the last attempt has finished. */
async function submitWithToken(tokens: number): Promise<void> {
  await waitFor(() => expect(turnstile.issued).toHaveLength(tokens));
  await waitFor(() => expect(screen.getByTestId('recover-submit')).toBeEnabled());
  fireEvent.click(screen.getByTestId('recover-submit'));
}

beforeEach(() => {
  h.w = world(false);
  alice = h.w.agent.account('alice');
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
  h.discovered = null;
  h.w.agent.admission.required = true;
  turnstile = installFakeTurnstile();
});
afterEach(() => {
  h.w.stop();
  delete window.turnstile;
  h.discoveredByServer = new Map();
  h.accountServers = new Map<string, string>();
  document.querySelectorAll('script').forEach((s) => s.remove());
});

describe('recovering on a workspace that asks for a human check', () => {
  it('shows the check under the "recover" action, bound to the workspace, and sends its token', async () => {
    h.discoveredByServer = new Map([[SERVER, { required: true, siteKey: ALWAYS_PASS }]]);
    await fillRecovery();
    await submitWithToken(1);
    expect(await screen.findByTestId('recovery-console')).toBeInTheDocument();
    expect(turnstile.rendered).toHaveLength(1);
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'recover', cData: 'bench' });
    expect(sentOf('RecoverAccount').map((b) => b.admission_token)).toEqual([turnstile.issued[0]]);
  });

  it('asks again when the sign-in after a fresh recovery is refused, and the console still says other devices were signed out', async () => {
    alice.heldHere = false;
    // A server reached only through the agent publishes its check with the refusal.
    h.w.agent.admission.challenge = { provider: 'turnstile', site_key: ALWAYS_PASS, identity: null };
    await fillRecovery();
    fireEvent.click(screen.getByTestId('recover-submit'));
    // Refused before the recovery: the check appears, and nothing was recovered.
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'recover' });
    expect(alice.heldHere).toBe(false);
    // The token pays for the recovery; the phrase sign-in after it is refused for want of one.
    await submitWithToken(1);
    await waitFor(() => expect(alice.heldHere).toBe(true));
    await waitFor(() => expect(screen.getByTestId('recover-submit')).toBeEnabled());
    // Answered on the check (asked again), not as an error, and no console yet.
    expect(screen.getByTestId('admission-check')).toBeInTheDocument();
    expect(screen.queryByTestId('recover-error')).toBeNull();
    expect(screen.queryByTestId('recovery-console')).toBeNull();
    // A fresh token: the account is held here now, so this attempt only signs in.
    await submitWithToken(2);
    expect(await screen.findByTestId('recovery-console-devices-signed-out')).toBeInTheDocument();
    expect(sentOf('RecoverAccount').map((b) => b.admission_token)).toEqual([null, turnstile.issued[0], turnstile.issued[1]]);
  });
});

describe('signing in with the password the console set', () => {
  it('shows the sign-in form\'s check when the workspace asks for one, then opens the workspace', async () => {
    h.w.agent.admission.required = false;
    h.discovered = { required: false, siteKey: ALWAYS_PASS };
    // The agent recorded the recovered account's server, as a registration does.
    h.accountServers = new Map([['alice', SERVER]]);
    await fillRecovery();
    fireEvent.click(screen.getByTestId('recover-submit'));
    fireEvent.click(await screen.findByTestId('recovery-console-begin'));
    fireEvent.click(screen.getByTestId('recovery-task-password'));
    type('console-password', NEW_PASSWORD);
    type('console-password-again', NEW_PASSWORD);
    fireEvent.click(screen.getByTestId('console-password-save'));
    expect(await screen.findByTestId('recovery-task-password')).toHaveAttribute('data-done', 'true');
    fireEvent.click(screen.getByTestId('recovery-console-done'));
    h.w.agent.admission.required = true;
    fireEvent.click(screen.getByTestId('recovery-console-continue'));

    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    await waitFor(() => expect(turnstile.rendered.at(-1)).toMatchObject({ sitekey: ALWAYS_PASS, action: 'sign-in', cData: 'bench' }));
    expect(field('username').value).toBe('alice');
    expect(field('password').value).toBe(NEW_PASSWORD);
    expect(onNext).not.toHaveBeenCalled();
    await waitFor(() => expect(turnstile.issued.at(-1)).toMatch(/@bench$/));
    await waitFor(() => expect(screen.getByTestId('login-submit')).toBeEnabled());
    const token: string | undefined = turnstile.issued.at(-1);
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(alice.cid.toString()));
    expect(sentOf('Connect').map((b) => b.admission_token)).toEqual([null, token]);
  });
});
