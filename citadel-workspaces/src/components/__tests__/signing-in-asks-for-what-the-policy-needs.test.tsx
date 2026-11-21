/**
 * The sign-in form, for each sign-in policy.
 *
 * Password accounts are unchanged. A PasswordAndKey account is asked to touch
 * its key after the password, by the challenge the server sends; a KeyOnly
 * account signs in with no password field.
 *
 * Doubled, each at an I/O seam:
 * - the agent (fake-agent.ts) behind the REAL AuthOperations, so the Connect on
 *   the wire is the one production builds;
 * - the authenticator (passkey fakes): navigator.credentials;
 * - connectionManager, tab-context, post-auth setup and messaging: IndexedDB
 *   and the workspace/ILM requests a signed-in session makes, which have no
 *   backend here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).connectionDouble(orig));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).tabContextDouble(orig));
vi.mock('@/lib/post-auth-setup', async () => ({ postAuthSetup: (await import('./login-world')).loginWorld.postAuth }));
// The P2P startup a signed-in session triggers; nothing here to start it against.
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).passkeyDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));

import { Login } from '../Login';
import { SecurityKeyPromptHost as SecurityKeyPrompt } from '../sign-in/SecurityKeyPromptHost';
import { enrolKey, world } from '@/lib/sign-in/__tests__/helpers';
import { loginWorld as h } from './login-world';
import { listHints } from '@/lib/sign-in/hints';

let onNext: ReturnType<typeof vi.fn>;
function renderLogin(): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} /><SecurityKeyPrompt /></MemoryRouter>);
}
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } }); };
const submit = (): void => { fireEvent.click(screen.getByTestId('login-submit')); };
const connects = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Connect').map(([, b]) => b);

async function accountWithKey(policy: 'PasswordAndKey' | 'KeyOnly'): Promise<FakeAccount> {
  const alice: FakeAccount = h.w.agent.account('alice');
  await enrolKey(h.w, alice);
  alice.policy = policy;
  return alice;
}

beforeEach(() => { h.w = world(false); h.postAuth.mockReset(); h.messaging.mockReset().mockResolvedValue(true); });
afterEach(() => h.w.stop());

describe('a Password account', () => {
  it('signs in as before, and is never asked for a key', async () => {
    h.w.agent.account('alice');
    renderLogin();
    type('username', 'alice'); type('password', 'correct horse battery'); submit();
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(screen.queryByTestId('security-key-prompt')).toBeNull();
  });
});

describe('a PasswordAndKey account', () => {
  it('asks for the touch after the password, with a countdown, and signs in', async () => {
    await accountWithKey('PasswordAndKey');
    renderLogin();
    type('username', 'alice'); type('password', 'correct horse battery'); submit();
    expect(await screen.findByText('Touch your security key')).toBeInTheDocument();
    expect(screen.getByTestId('security-key-countdown')).toHaveTextContent('60 seconds left');
    expect(screen.getByTestId('security-key-continue')).toHaveFocus();
    fireEvent.click(screen.getByTestId('security-key-continue'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects()[0]).toMatchObject({ security_key: true });
  });

  it('Cancel declines: the sign-in fails now, with the reason', async () => {
    await accountWithKey('PasswordAndKey');
    renderLogin();
    type('username', 'alice'); type('password', 'correct horse battery'); submit();
    fireEvent.click(await screen.findByTestId('security-key-cancel'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled/i);
    expect(h.w.agent.sent.map(([v]) => v)).toContain('SecurityKeyDecline');
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('a KeyOnly account', () => {
  it('signs in key-first: no password field, no password sent', async () => {
    await accountWithKey('KeyOnly');
    renderLogin();
    fireEvent.click(screen.getByTestId('login-mode-key'));
    expect(document.getElementById('password')).toBeNull();
    type('username', 'alice'); submit();
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects()[0]).toMatchObject({ password: null, security_key: true });
    // Remembered by tenant and CID, so the form offers the key first next time.
    expect(await listHints(h.w.deps.store)).toEqual([{ tenant: 'bench.work.avarok.net', cid: 7n, username: 'alice', keyFirst: true }]);
  });
});
