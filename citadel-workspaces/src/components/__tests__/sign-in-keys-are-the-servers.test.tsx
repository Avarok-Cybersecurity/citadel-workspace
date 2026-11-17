/**
 * Settings -> Sign-in keys is the server's list, and every change goes through
 * the server with a fresh step-up: list, add (with its Enrol touch), rename,
 * remove (refused, in the server's words, when the policy would be left
 * unsatisfiable), switch the policy, and regenerate the recovery codes (shown
 * once).
 *
 * Doubled at the I/O seams: the agent and authenticator (sign-in fakes) via the
 * composition root, and the tab selection, which is IndexedDB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { World } from '@/lib/sign-in/__tests__/helpers';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

const h: { w: World } = vi.hoisted(() => ({ w: undefined as unknown as World }));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => ({
  ...(await orig()),
  getSelectedUser: async (): Promise<Record<string, unknown>> => ({ selectedUsername: 'alice', selectedCid: 7n, selectedServerAddress: 'bench.work.avarok.net' }),
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getTabSelectedSession: async (): Promise<null> => null } }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), browserSignInDeps: (): World['deps'] => h.w.deps }));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), passkeysAvailableHere: (): boolean => true }));

import { SignInKeysSection } from '../passkey/SignInKeysSection';
import { SecurityKeyPrompt } from '../sign-in/SecurityKeyPrompt';
import { enrolKey, world } from '@/lib/sign-in/__tests__/helpers';
import { listHints } from '@/lib/sign-in/hints';

let alice: FakeAccount;
const PASSWORD: string = 'correct horse battery';

function renderSection(): void {
  render(<><SignInKeysSection /><SecurityKeyPrompt /></>);
}
async function stepUpWithPassword(): Promise<void> {
  const field: HTMLElement = await screen.findByLabelText('Your password');
  fireEvent.change(field, { target: { value: PASSWORD } });
  fireEvent.click(screen.getByTestId('step-up-submit'));
}
const status = (): HTMLElement => screen.getByTestId('sign-in-keys-status');
/** Listing needs a step-up too: open the section with the password, or with a key touch. */
async function openSection(via: 'password' | 'key'): Promise<void> {
  renderSection();
  fireEvent.click(await screen.findByTestId('show-sign-in-keys'));
  if (via === 'password') await stepUpWithPassword();
  else {
    fireEvent.click(await screen.findByTestId('step-up-key'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
  }
  await screen.findByText('YubiKey');
}

beforeEach(async () => {
  h.w = world(false);
  alice = h.w.agent.account('alice');
  await enrolKey(h.w, alice, 'YubiKey');
});
afterEach(() => h.w.stop());

describe('Settings -> Sign-in keys', () => {
  it('lists the keys the server holds', async () => {
    await openSection('password');
    expect(screen.getByTestId('recovery-codes-left')).toHaveTextContent('10 unused');
  });

  it('adds a key after a step-up, with its Enrol touch', async () => {
    await openSection('password');
    fireEvent.change(screen.getByLabelText('Name this key'), { target: { value: 'Touch ID' } });
    fireEvent.click(screen.getByTestId('add-passkey'));
    await stepUpWithPassword();
    expect(await screen.findByText('Touch your new security key')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('security-key-continue'));
    expect(await screen.findByText('Touch ID')).toBeInTheDocument();
    expect(alice.keys.map((k) => k.label)).toEqual(['YubiKey', 'Touch ID']);
  });

  it('renames a key', async () => {
    await openSection('password');
    fireEvent.click(await screen.findByTestId('sign-in-key-rename'));
    fireEvent.change(screen.getByLabelText('New name for YubiKey'), { target: { value: 'Blue YubiKey' } });
    fireEvent.click(screen.getByTestId('sign-in-key-save-name'));
    await stepUpWithPassword();
    expect(await screen.findByText('Blue YubiKey')).toBeInTheDocument();
    expect(alice.keys[0].label).toBe('Blue YubiKey');
  });

  it('shows the server refusing to remove the key a KeyOnly account needs', async () => {
    alice.policy = 'KeyOnly';
    await openSection('key');
    fireEvent.click(await screen.findByTestId('sign-in-key-remove'));
    fireEvent.click(await screen.findByTestId('confirm-remove-key'));
    fireEvent.click(await screen.findByTestId('step-up-key'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    await waitFor(() => expect(status()).toHaveTextContent('Removing that key would leave no way to satisfy the sign-in policy'));
    expect(alice.keys).toHaveLength(1);
  });

  it('switches the policy, and this device remembers a key-first account by tenant and CID', async () => {
    await openSection('password');
    fireEvent.click(screen.getByTestId('settings-policy-KeyOnly'));
    await stepUpWithPassword();
    await waitFor(() => expect(alice.policy).toBe('KeyOnly'));
    await waitFor(async () => expect(await listHints(h.w.deps.store)).toEqual([
      { tenant: 'bench.work.avarok.net', cid: 7n, username: 'alice', keyFirst: true },
    ]));
  });

  it('regenerates the recovery codes and shows them once', async () => {
    await openSection('password');
    const before: string[] = [...alice.recoveryCodes];
    fireEvent.click(screen.getByTestId('regenerate-recovery-codes'));
    await stepUpWithPassword();
    const shown: string[] = (await screen.findAllByTestId('recovery-code')).map((li) => li.textContent ?? '');
    expect(shown).toEqual(alice.recoveryCodes);
    expect(shown).not.toEqual(before);
    fireEvent.click(screen.getByTestId('recovery-codes-saved'));
    fireEvent.click(screen.getByTestId('recovery-codes-done'));
    expect(screen.queryByTestId('recovery-code')).toBeNull();
  });

  it('asks for the step-up before it lists anything, and sends the list with it', async () => {
    renderSection();
    const before: number = h.w.agent.sent.length;
    fireEvent.click(await screen.findByTestId('show-sign-in-keys'));
    fireEvent.click(await screen.findByTestId('step-up-cancel'));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(h.w.agent.sent.length).toBe(before);
    expect(screen.queryByText('YubiKey')).toBeNull();
    fireEvent.click(screen.getByTestId('show-sign-in-keys'));
    await stepUpWithPassword();
    await screen.findByText('YubiKey');
    const list: Record<string, unknown> | undefined = h.w.agent.sent.map(([, b]) => b).find((b) => b.op === 'ListCredentials');
    expect(list?.step_up).toEqual({ password: Array.from(new TextEncoder().encode(PASSWORD)), security_key: true });
  });

  it('shows the policy the server reports', async () => {
    alice.policy = 'PasswordAndKey';
    await openSection('key');
    expect(screen.getByTestId('settings-policy-PasswordAndKey')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('settings-policy-Password')).toHaveAttribute('data-state', 'unchecked');
  });

  it('sends nothing when the step-up is cancelled', async () => {
    await openSection('password');
    const sent: number = h.w.agent.sent.length;
    fireEvent.click(screen.getByTestId('regenerate-recovery-codes'));
    fireEvent.click(await screen.findByTestId('step-up-cancel'));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(h.w.agent.sent.length).toBe(sent);
  });
});
