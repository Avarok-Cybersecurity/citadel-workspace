/**
 * A workspace that asks for a human check (Cloudflare Turnstile) gets one on
 * its sign-in form, and only then; the token rides in Connect as
 * `admission_token`, once. Discovery fails open and the server fails closed: a
 * refusal reveals the check when discovery could not say, and a failed check is
 * reset with a retry message.
 *
 * Doubled at the I/O seams (login-world.ts): the agent, IndexedDB, the
 * control-plane fetch for discovery, and Turnstile itself (fake-turnstile.ts,
 * on Cloudflare's TEST site keys -- no real challenge is fetched or solved).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
import { world } from '@/lib/sign-in/__tests__/helpers';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { ALWAYS_FAIL, ALWAYS_PASS, installFakeTurnstile, turnstileScriptLoaded, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

let onNext: ReturnType<typeof vi.fn>;
let turnstile: FakeTurnstile;
function renderLogin(initialUsername: string | undefined = undefined): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={initialUsername} /></MemoryRouter>);
}
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } }); };
function signIn(): void {
  type('username', 'alice'); type('password', 'correct horse battery');
  fireEvent.click(screen.getByTestId('login-submit'));
}
const connects = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Connect').map(([, b]) => b);

beforeEach(() => {
  h.w = world(false);
  h.w.agent.account('alice');
  h.discovered = null;
  h.signedOut = [];
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
});
afterEach(() => { h.w.stop(); delete window.turnstile; h.accountServers = new Map<string, string>(); document.querySelectorAll('script').forEach((s) => s.remove()); });

describe('a workspace that does not ask', () => {
  it('shows no check and never loads Cloudflare', async () => {
    h.discovered = { required: false, siteKey: ALWAYS_PASS };
    renderLogin();
    signIn();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(screen.queryByTestId('admission-check')).toBeNull();
    expect(turnstileScriptLoaded()).toBe(false);
    expect(connects()[0]).toMatchObject({ admission_token: null });
  });
});

describe('a workspace that asks', () => {
  beforeEach(() => {
    h.w.agent.admission.required = true;
    turnstile = installFakeTurnstile();
    // The agent recorded alice's workspace, so her check binds to it (a-key-signs-in-past-a-human-check
    // covers an account whose workspace nobody knows).
    h.accountServers = new Map([['alice', 'bench.work.avarok.net']]);
  });

  it('shows the check, with its site key, and sends its token in Connect', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderLogin('alice');
    expect(await screen.findByTestId('admission-check')).toBeInTheDocument();
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'sign-in' });
    signIn();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(connects()[0]).toMatchObject({ admission_token: turnstile.issued[0] });
  });

  it('binds the check to the account\'s workspace once the agent says which it is', async () => {
    h.accountServers = new Map([['alice', 'bench.work.avarok.net']]);
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderLogin();
    await waitFor(() => expect(turnstile.rendered.length).toBeGreaterThan(0));
    expect(turnstile.rendered[0]).not.toHaveProperty('cData');
    type('username', 'alice');
    await waitFor(() => expect(turnstile.rendered.at(-1)).toMatchObject({ action: 'sign-in', cData: 'bench' }));
  });

  it('sends nothing until the check is done', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_FAIL };
    renderLogin();
    await screen.findByTestId('admission-check');
    signIn();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.completeFirst);
    expect(connects()).toEqual([]);
  });

  it('spends a token once: the next attempt gets a fresh one', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderLogin('alice');
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    type('username', 'alice'); type('password', 'wrong'); fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(turnstile.issued).toHaveLength(2));
    signIn();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(connects().map((c) => c.admission_token)).toEqual([turnstile.issued[0], turnstile.issued[1]]);
  });

  it('when discovery could not answer, the server\'s refusal reveals the check, and it then signs in', async () => {
    h.discovered = null;
    renderLogin();
    signIn();
    // Answers now, and even says "not required": the server's refusal is what counts.
    h.discovered = { required: false, siteKey: ALWAYS_PASS };
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    expect(connects()[0]).toMatchObject({ admission_token: null });
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    signIn();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(connects()[1]).toMatchObject({ admission_token: turnstile.issued[0] });
  });

  it('says so when the check is required but cannot be loaded', async () => {
    h.discovered = null;
    renderLogin();
    signIn();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.unavailable);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('an account the server signed out is asked plainly to sign in again, with the check', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    h.signedOut = [{ cid: 7n, username: 'alice', reason: 'the server asked for a human check' }];
    renderLogin('alice');
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.signInAgain);
    expect(screen.getByTestId('admission-check')).toBeInTheDocument();
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    type('password', 'correct horse battery');
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalled());
  });

  it('a check the server rejects is reset with the retry message', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderLogin('alice');
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    h.w.agent.admission.spent.add(turnstile.issued[0]);
    signIn();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.failed);
    expect(turnstile.resets).toBeGreaterThan(0);
    expect(onNext).not.toHaveBeenCalled();
  });
});
