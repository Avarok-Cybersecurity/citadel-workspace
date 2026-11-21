/**
 * The sign-in form offers a passkey before a username is typed.
 *
 * "Use passkey" appeared only after a username with keys had been typed, so a
 * person who enrolled a key to stop typing still had to type. Now every
 * account enrolled on this device is offered up front, with a choice when
 * there are several.
 *
 * Doubled: only the agent's LocalDB, as the in-memory store in
 * lib/passkey/__tests__/fakes.ts. The accounts are the sign-in hints a key-first
 * sign-in leaves, written by the real hint code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemoryStore } from '@/lib/passkey/__tests__/fakes';
import { saveHint } from '@/lib/sign-in/hints';

const h: { store: MemoryStore } = vi.hoisted((): { store: MemoryStore } => ({
  store: undefined as unknown as MemoryStore,
}));

vi.mock('@/lib/passkey', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  passkeysAvailableHere: (): boolean => true,
}));
vi.mock('@/lib/sign-in', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  browserSignInDeps: (): { store: MemoryStore } => ({ store: h.store }),
}));

import { Login } from '../Login';

function renderLogin(): void {
  render(
    <MemoryRouter>
      <Login onNext={() => {}} onCancel={() => {}} initialUsername={undefined} />
    </MemoryRouter>,
  );
}

async function enrol(username: string, cid: bigint): Promise<void> {
  await saveHint(h.store, { tenant: 'bench.work.avarok.net', cid, username, keyFirst: true });
}

beforeEach(() => { h.store = new MemoryStore(); });

describe('the sign-in form on a device with a passkey', () => {
  it('offers it with the username still empty', async () => {
    await enrol('alice', 7n);
    renderLogin();
    expect(await screen.findByTestId('login-passkey')).toHaveTextContent('Use passkey or security key');
  });

  it('asks which account when several are enrolled', async () => {
    await enrol('alice', 7n);
    await enrol('bob', 8n);
    renderLogin();
    await waitFor(() => expect(screen.getAllByTestId('login-passkey-name').map(b => b.textContent)).toEqual(['alice', 'bob']));
  });

  it('offers nothing on a device with no passkey', async () => {
    renderLogin();
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('login-passkey')).toBeNull();
    expect(screen.queryByTestId('login-passkey-account')).toBeNull();
  });
});
