/**
 * A sign-in's Connect names the server, and it is the server the form chose.
 *
 * The agent finds an account by username alone, so a Connect that named no server
 * signed in whichever account of that name the agent held, on whatever server it
 * was registered to. The agent now refuses a Connect whose account is on another
 * server; the form must therefore say which server it means -- its scope, spelled
 * as the agent reports the account -- and send nothing it knows would be refused.
 *
 * Doubled at the I/O seams (login-world.ts): the agent (fake-agent.ts keeps the
 * rule: a Connect naming another server than the account's is refused, typed),
 * IndexedDB and the workspace work a signed-in session starts.
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
import { SIGN_IN_SERVER_COPY } from '@/lib/sessions/sign-in-server';
import { loginWorld as h } from './login-world';

const BENCH: string = 'bench.work.avarok.net';
const ACME: string = 'acme.work.avarok.net';
let onNext: ReturnType<typeof vi.fn>;
const connects = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Connect').map(([, b]) => b);
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } }); };

function signIn(scope: string | undefined, username: string): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} scope={scope} /></MemoryRouter>);
  type('username', username);
  type('password', 'correct horse battery');
  fireEvent.click(screen.getByTestId('login-submit'));
}

beforeEach(() => {
  h.w = world(false);
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
  h.discovered = { required: false, siteKey: '' };
});
afterEach(() => { h.w.stop(); });

describe('the server a sign-in names', () => {
  it('a form scoped to a server sends that server, and signs in there', async () => {
    h.w.agent.account('alice').server = BENCH;
    signIn(`wss://${BENCH}/`, 'alice');
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    // The agent's spelling of the scope, which it compares as text.
    expect(connects().map((c) => c.server_address)).toEqual([BENCH]);
  });

  it('an unscoped form sends the server the agent says the account is on', async () => {
    h.w.agent.account('alice').server = ACME;
    signIn(undefined, 'alice');
    await waitFor(() => expect(onNext).toHaveBeenCalledWith('7'));
    expect(connects().map((c) => c.server_address)).toEqual([ACME]);
  });

  it('a form scoped to another server than the account sends nothing', async () => {
    h.w.agent.account('alice').server = ACME;
    signIn(BENCH, 'alice');
    expect(await screen.findByTestId('login-wrong-server')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('login-submit'));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(connects()).toEqual([]);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('a username this computer has no account for is said so, on the field, and nothing is sent', async () => {
    h.w.agent.account('alice').server = BENCH;
    signIn(undefined, 'alicia');
    expect(await screen.findByText(SIGN_IN_SERVER_COPY.no_such_account('alicia'))).toBeInTheDocument();
    expect(document.getElementById('username')).toHaveAttribute('aria-invalid', 'true');
    expect(connects()).toEqual([]);
  });
});
