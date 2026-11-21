/**
 * A sign-in opened for a server -- from the top bar's switcher, a session that ended
 * mid-click, Manage Accounts or an account link -- shows only that server's accounts,
 * says which server it is, and will not send a username this device knows only on
 * another server: the agent would sign in THERE. The user is offered that server
 * instead, or types the username they use here.
 *
 * Doubled: the agent's LocalDB (sign-in hints written by the real hint code), the agent's
 * account list (GetAccountInformation), the browser's saved sessions, and the agent's
 * Connect -- counted, so a sign-in that should not be sent can be seen not to be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AccountHost } from '@/lib/admission/account-servers';
import { MemoryStore } from '@/lib/passkey/__tests__/fakes';
import { saveHint } from '@/lib/sign-in/hints';

const A: string = 'bench.work.avarok.net';
const B: string = 'acme.work.avarok.net';
const h: { store: MemoryStore; connects: string[] } = vi.hoisted(() => ({
  store: undefined as unknown as MemoryStore, connects: [] as string[],
}));

vi.mock('@/lib/passkey', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()), passkeysAvailableHere: (): boolean => true,
}));
vi.mock('@/lib/sign-in', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()), browserSignInDeps: (): { store: MemoryStore } => ({ store: h.store }),
}));
vi.mock('@/lib/admission', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  browserAccountHosts: async (): Promise<AccountHost[]> => [{ username: 'alice', server: A }, { username: 'bob', server: B }],
  browserAccountServers: async (): Promise<Map<string, string>> => new Map<string, string>(),
  browserDiscoverAdmission: async (): Promise<null> => null,
}));
vi.mock('@/lib/websocket-service', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const real: typeof import('@/lib/websocket-service') = (await importOriginal()) as typeof import('@/lib/websocket-service');
  const { doubleOf } = await import('@/test/singleton-double');
  return {
    ...real,
    websocketService: doubleOf(real.websocketService, {
      connect: (async (_id: string, user: string): Promise<void> => { h.connects.push(user); throw new Error('not in this test'); }) as never,
    }),
  };
});

import { Login } from '../Login';

function renderLogin(scope: string | undefined): void {
  render(<MemoryRouter><Login onNext={() => {}} onCancel={() => {}} initialUsername={undefined} scope={scope} /></MemoryRouter>);
}
const typeUsername: (value: string) => void = (value: string): void => { fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value } }); };

beforeEach(async () => {
  h.store = new MemoryStore();
  h.connects = [];
  await saveHint(h.store, { tenant: A, cid: 7n, username: 'alice', keyFirst: true });
  await saveHint(h.store, { tenant: B, cid: 8n, username: 'bob', keyFirst: true });
});

describe('a sign-in scoped to a server', () => {
  it('says which server, and the username field is described by it', async () => {
    renderLogin(A);
    expect(await screen.findByTestId('login-scope')).toHaveTextContent(`Signing in to ${A}`);
    expect(screen.getByLabelText(/^username$/i).getAttribute('aria-describedby')).toContain('login-scope');
  });

  it("offers only that server's accounts", async () => {
    renderLogin(A);
    await waitFor(() => expect(screen.getByTestId('login-passkey')).toHaveTextContent(`alice · ${A}`));
    expect(screen.queryByText(new RegExp(B))).toBeNull();
  });

  it('says when no saved account is on it, and still takes a username', async () => {
    renderLogin('new.work.avarok.net');
    expect(await screen.findByTestId('login-scope-empty')).toHaveTextContent('No account for new.work.avarok.net is saved on this device');
    typeUsername('zed');
    expect(screen.getByTestId('login-submit')).toBeEnabled();
  });
});

describe("another server's username, typed or autofilled", () => {
  it('is named for what it is, and not sent', async () => {
    renderLogin(A);
    await screen.findByTestId('login-scope');
    await waitFor(() => expect(screen.queryByTestId('login-passkey')).not.toBeNull());
    typeUsername('bob');
    expect(await screen.findByTestId('login-wrong-server')).toHaveTextContent(`bob is an account on ${B}, not ${A}.`);
    expect(screen.getByTestId('login-submit')).toHaveAttribute('aria-describedby', 'login-wrong-server');
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(document.activeElement).toBe(screen.getByTestId('login-switch-server'));
    expect(h.connects).toEqual([]);
  });

  it('can be signed in to on its own server instead', async () => {
    renderLogin(A);
    await waitFor(() => expect(screen.queryByTestId('login-passkey')).not.toBeNull());
    typeUsername('bob');
    fireEvent.click(await screen.findByTestId('login-switch-server'));
    expect(screen.getByTestId('login-scope')).toHaveTextContent(`Signing in to ${B}`);
    expect(screen.queryByTestId('login-wrong-server')).toBeNull();
    expect(screen.getByTestId('login-submit')).toBeEnabled();
  });
});

describe('a sign-in with no server chosen', () => {
  it('names the server of every row', async () => {
    renderLogin(undefined);
    await waitFor(() => expect(screen.getAllByTestId('login-passkey-server').map((e) => e.textContent)).toEqual([A, B]));
    expect(screen.queryByTestId('login-scope')).toBeNull();
    typeUsername('bob');
    expect(screen.queryByTestId('login-wrong-server')).toBeNull();
  });
});
