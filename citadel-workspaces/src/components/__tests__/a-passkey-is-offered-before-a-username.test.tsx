/**
 * The sign-in form offers a passkey before a username is typed.
 *
 * "Use passkey" appeared only after a username with keys had been typed, so a
 * person who enrolled a key to stop typing still had to type. Now every
 * account enrolled on this device is offered up front, with a choice when
 * there are several.
 *
 * Doubled: only the two passkey ports (the agent's LocalDB and the
 * authenticator), as in lib/passkey/__tests__/fakes.ts. Records are written by
 * the real enrolment code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { testDeps } from '@/lib/passkey/__tests__/fakes';
import { enrolCredential } from '@/lib/passkey/__tests__/legacy-enrol';

const h: { deps: ReturnType<typeof testDeps> } = vi.hoisted((): { deps: ReturnType<typeof testDeps> } => ({
  deps: undefined as unknown as ReturnType<typeof testDeps>,
}));

vi.mock('@/lib/passkey', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  passkeysAvailableHere: (): boolean => true,
  browserPasskeyDeps: (): ReturnType<typeof testDeps> => h.deps,
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
  await enrolCredential(h.deps, { username, cid, label: 'MacBook', password: 'correct horse battery' });
}

beforeEach(() => { h.deps = testDeps(); });

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
