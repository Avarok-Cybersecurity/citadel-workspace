/**
 * A key-first sign-in on a workspace that asks for a human check.
 *
 * Live (2026-10-04, agent log): the passkey button sent a Connect with no token
 * and was asked for the check; once the check was done, the retry was refused
 * with "the Turnstile answer is for another workspace". The password sign-in,
 * typed by hand, worked. The token must be bound to the account's workspace
 * (Turnstile `cData`, the tenant's slug) whichever way the account was chosen.
 *
 * Doubled at the I/O seams (login-world.ts): the agent, IndexedDB, the
 * control-plane fetch for discovery and Turnstile itself (fake-turnstile.ts, on
 * Cloudflare's TEST site keys). The fake admission refuses a token bound to no
 * workspace or another one, as the tenant worker's boundVerdict does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).connectionDouble(orig));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).tabContextDouble(orig));
vi.mock('@/lib/post-auth-setup', async () => ({ postAuthSetup: (await import('./login-world')).loginWorld.postAuth }));
vi.mock('@/lib/start-messaging', async () => ({ startMessagingForSession: (await import('./login-world')).loginWorld.messaging }));
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).passkeyDouble(orig));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));

import { Login } from '../Login';
import { enrolKey, world } from '@/lib/sign-in/__tests__/helpers';
import { saveHint } from '@/lib/sign-in/hints';
import { enrolCredential } from '@/lib/passkey/__tests__/legacy-enrol';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { PASSWORD_THEN_KEY } from '../passkey/passkey-offer';
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

const SERVER: 'bench.work.avarok.net' = 'bench.work.avarok.net';
let onNext: ReturnType<typeof vi.fn>;
function renderLogin(): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} /></MemoryRouter>);
}
let turnstile: FakeTurnstile;
const connects = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Connect').map(([, b]) => b);

async function keyFirstAccount(): Promise<FakeAccount> {
  const alice: FakeAccount = h.w.agent.account('alice');
  await enrolKey(h.w, alice);
  alice.policy = 'KeyOnly';
  await saveHint(h.w.deps.store, { tenant: SERVER, cid: alice.cid, username: 'alice', keyFirst: true });
  return alice;
}

beforeEach(() => {
  // Touches the key whenever the server asks: the sign-in's own challenge.
  h.w = world(true);
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
  h.accountServers = new Map([['alice', SERVER]]);
  // The control plane, asked before a workspace is known, gives the site key and requires nothing.
  h.discovered = { required: false, siteKey: ALWAYS_PASS };
  h.discoveredByServer = new Map([[SERVER, { required: true, siteKey: ALWAYS_PASS }]]);
  h.w.agent.admission.required = true;
  h.w.agent.admission.workspace = 'bench';
  turnstile = installFakeTurnstile();
});
afterEach(() => {
  h.w.stop();
  delete window.turnstile;
  h.accountServers = new Map<string, string>();
  h.discoveredByServer = new Map();
  h.pageWorkspace = undefined;
  document.querySelectorAll('script').forEach((s) => s.remove());
});

/** Press the passkey button until the human check is done and the sign-in goes through. */
async function signInWithThePasskeyButton(): Promise<void> {
  fireEvent.click(await screen.findByTestId('login-passkey'));
  // Asked first: discovery could not know the workspace before an account was chosen.
  await screen.findByTestId('admission-check');
  await waitFor(() => expect(turnstile.issued.at(-1)).toMatch(/@bench$/));
  // A person presses it again once the first attempt has finished.
  await waitFor(() => expect(screen.getByTestId('login-passkey')).toBeEnabled());
  fireEvent.click(screen.getByTestId('login-passkey'));
}

describe('a passkey sign-in on a workspace that asks for a human check', () => {
  it('a key-first account signs in, its token bound to its workspace', async () => {
    await keyFirstAccount();
    renderLogin();
    await signInWithThePasskeyButton();
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects().at(-1)).toMatchObject({ password: null, security_key: true });
    expect(connects().at(-1)?.admission_token).toMatch(/@bench$/);
  });

  it('a key-first account binds to the workspace this device remembers, when the agent has no host for it', async () => {
    await keyFirstAccount();
    h.accountServers = new Map<string, string>();
    renderLogin();
    await signInWithThePasskeyButton();
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
  });

  it('an option-A passkey signs in, its token bound to its workspace', async () => {
    const alice: FakeAccount = h.w.agent.account('alice');
    await enrolCredential({ ...h.w.deps, now: (): number => 1 }, { username: 'alice', cid: alice.cid, label: 'Mac', password: alice.password });
    renderLogin();
    await signInWithThePasskeyButton();
    // Signed in: the form then offers to move the passkey to the server.
    expect(await screen.findByTestId('add-security-key')).toBeInTheDocument();
    expect(connects().at(-1)?.admission_token).toMatch(/@bench$/);
  });
});

describe('an account whose key follows its password, on a workspace that asks for a human check', () => {
  it('its passkey button asks for the password first, never a key-only sign-in, then signs in with the touch', async () => {
    const alice: FakeAccount = h.w.agent.account('alice');
    await enrolKey(h.w, alice);
    alice.policy = 'PasswordAndKey';
    await saveHint(h.w.deps.store, { tenant: SERVER, cid: alice.cid, username: 'alice', keyFirst: false });
    renderLogin();
    fireEvent.click(await screen.findByTestId('login-passkey'));
    expect(await screen.findByTestId('login-key-next')).toHaveTextContent(PASSWORD_THEN_KEY);
    expect((document.getElementById('username') as HTMLInputElement).value).toBe('alice');
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('password')));
    expect(connects()).toEqual([]);
    await waitFor(() => expect(turnstile.issued.at(-1)).toMatch(/@bench$/));
    fireEvent.change(document.getElementById('password') as HTMLElement, { target: { value: alice.password } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects()).toHaveLength(1);
    expect(connects()[0]).toMatchObject({ security_key: true });
    expect(connects()[0].admission_token).toMatch(/@bench$/);
  });
});

/** A password account the agent has no host for, and no hint names: the page or the user must say. */
async function signInWithAPassword(): Promise<void> {
  const alice: FakeAccount = h.w.agent.account('alice');
  h.accountServers = new Map<string, string>();
  renderLogin();
  fireEvent.change(document.getElementById('username') as HTMLElement, { target: { value: 'alice' } });
  fireEvent.change(document.getElementById('password') as HTMLElement, { target: { value: alice.password } });
  fireEvent.click(screen.getByTestId('login-submit'));
  await screen.findByTestId('admission-check');
}

describe('a sign-in whose workspace neither the agent nor this device knows', () => {
  it('binds the check to the workspace the page is served from', async () => {
    h.pageWorkspace = SERVER;
    await signInWithAPassword();
    await waitFor(() => expect(turnstile.issued.at(-1)).toMatch(/@bench$/));
    await waitFor(() => expect(screen.getByTestId('login-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(screen.queryByTestId('admission-workspace')).toBeNull();
  });

  it('asks for the workspace address, refuses one that is not, and sends nothing unbound', async () => {
    await signInWithAPassword();
    const field: HTMLElement = await screen.findByLabelText(ADMISSION_COPY.workspaceLabel);
    const before: number = connects().length;
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.workspaceNeeded);
    fireEvent.change(field, { target: { value: 'not a workspace' } });
    expect(await screen.findByTestId('admission-workspace-error')).toHaveTextContent(ADMISSION_COPY.workspaceInvalid);
    fireEvent.change(field, { target: { value: 'bench.work.avarok.net' } });
    await waitFor(() => expect(turnstile.issued.at(-1)).toMatch(/@bench$/));
    expect(connects()).toHaveLength(before);
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects().at(-1)?.admission_token).toMatch(/@bench$/);
  });
});
