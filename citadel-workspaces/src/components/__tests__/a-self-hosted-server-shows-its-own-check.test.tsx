/**
 * A self-hosted server that asks for a human check has no HTTP discovery: the
 * browser reaches it only through the agent. Its `admission_required` refusal
 * publishes the check instead (`admission_challenge`), and the sign-in form
 * renders that widget -- its site key, bound to its identity -- and retries
 * with the token. A challenge the form cannot trust is ignored.
 *
 * Doubled at the I/O seams (login-world.ts), as a-workspace-can-ask-for-a-human-check.
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
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

/** The identity a native server's kernel.toml names (`turnstile_cdata`). */
const IDENTITY: 'citadel-example' = 'citadel-example';

let onNext: ReturnType<typeof vi.fn>;
let turnstile: FakeTurnstile;
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } }); };
function signIn(): void {
  type('username', 'alice'); type('password', 'correct horse battery');
  fireEvent.click(screen.getByTestId('login-submit'));
}
const connects = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Connect').map(([, b]) => b);

beforeEach(() => {
  h.w = world(false);
  h.w.agent.account('alice');
  h.w.agent.admission.required = true;
  h.w.agent.admission.workspace = IDENTITY;
  // Self-hosted: no control plane answers for it.
  h.discovered = null;
  h.signedOut = [];
  h.accountServers = new Map([['alice', 'citadel.example.com:12349']]);
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
  turnstile = installFakeTurnstile();
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername="alice" /></MemoryRouter>);
});
afterEach(() => { h.w.stop(); delete window.turnstile; h.accountServers = new Map<string, string>(); document.querySelectorAll('script').forEach((s) => s.remove()); });

describe('a self-hosted server that asks for a human check', () => {
  it('shows the check its refusal published, bound to its identity, and signs in with the token', async () => {
    h.w.agent.admission.challenge = { provider: 'turnstile', site_key: ALWAYS_PASS, identity: IDENTITY };
    expect(screen.queryByTestId('admission-check')).toBeNull();
    signIn();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'sign-in', cData: IDENTITY });
    signIn();
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(connects().map((c) => c.admission_token)).toEqual([null, turnstile.issued[0]]);
  });

  for (const [name, challenge] of [
    ['an unknown provider', { provider: 'recaptcha', site_key: ALWAYS_PASS, identity: IDENTITY }],
    ['a site key that is not one', { provider: 'turnstile', site_key: '<script>', identity: IDENTITY }],
    ['an identity that is not one', { provider: 'turnstile', site_key: ALWAYS_PASS, identity: 7 }],
    ['no challenge object at all', 'turnstile'],
  ] as const) {
    it(`ignores ${name}: no widget, and the plain "unavailable" answer`, async () => {
      h.w.agent.admission.challenge = challenge;
      signIn();
      expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.unavailable);
      expect(turnstile.rendered).toEqual([]);
      expect(onNext).not.toHaveBeenCalled();
    });
  }
});
