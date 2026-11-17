/**
 * Option A is read only to leave it: an old passkey still opens its sealed
 * password once, the form then offers to add the key with the server, and
 * when that is done the sealed record is deleted. Nothing seals a password.
 *
 * Also here: a device that remembers a key-first account (by tenant and CID)
 * offers it before a username is typed, and the touch prompt gives up when its
 * window closes.
 *
 * Doubled at the I/O seams, through login-world.ts (see its header).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).connectionDouble(orig));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).tabContextDouble(orig));
vi.mock('@/lib/post-auth-setup', async () => ({ postAuthSetup: (await import('./login-world')).loginWorld.postAuth }));
vi.mock('@/lib/start-messaging', async () => ({ startMessagingForSession: (await import('./login-world')).loginWorld.messaging }));
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).passkeyDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));

import { Login } from '../Login';
import { SecurityKeyPrompt } from '../sign-in/SecurityKeyPrompt';
import { enrolKey, world } from '@/lib/sign-in/__tests__/helpers';
import { enrolCredential } from '@/lib/passkey/__tests__/legacy-enrol';
import { hasPasskeyLogin } from '@/lib/passkey/repository';
import { saveHint } from '@/lib/sign-in/hints';
import { loginWorld as h } from './login-world';

let onNext: ReturnType<typeof vi.fn>;
function renderLogin(): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} /><SecurityKeyPrompt /></MemoryRouter>);
}
const legacyDeps = (): Parameters<typeof enrolCredential>[0] => ({ ...h.w.deps, now: (): number => 1 });

beforeEach(() => { h.w = world(false); h.postAuth.mockReset(); h.messaging.mockReset().mockResolvedValue(true); });
afterEach(() => { h.w.stop(); vi.useRealTimers(); });

describe('an option-A passkey', () => {
  it('signs in once, moves to a server key, and its sealed password is deleted', async () => {
    const alice: FakeAccount = h.w.agent.account('alice');
    await enrolCredential(legacyDeps(), { username: 'alice', cid: alice.cid, label: 'Mac', password: alice.password });
    renderLogin();
    fireEvent.click(await screen.findByTestId('login-passkey'));
    expect(await screen.findByText('Move your passkey to the new sign-in')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-security-key-continue'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(alice.cid.toString()));
    expect(alice.keys).toHaveLength(1);
    expect(await hasPasskeyLogin(h.w.deps.store, h.w.deps.rpId, 'alice')).toBe(false);
  });

  it('keeps the record when the move is put off, so it can be offered again', async () => {
    const alice: FakeAccount = h.w.agent.account('alice');
    await enrolCredential(legacyDeps(), { username: 'alice', cid: alice.cid, label: 'Mac', password: alice.password });
    renderLogin();
    fireEvent.click(await screen.findByTestId('login-passkey'));
    fireEvent.click(await screen.findByTestId('add-security-key-skip'));
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(await hasPasskeyLogin(h.w.deps.store, h.w.deps.rpId, 'alice')).toBe(true);
  });

  it('is never written by a sign-in: a password sign-in seals nothing', async () => {
    h.w.agent.account('alice');
    renderLogin();
    fireEvent.change(document.getElementById('username') as HTMLElement, { target: { value: 'alice' } });
    fireEvent.change(document.getElementById('password') as HTMLElement, { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect([...h.w.deps.store.data.keys()].filter((k) => k.startsWith('passkey-login/'))).toEqual([]);
  });
});

describe('a device that remembers a key-first account', () => {
  it('offers it before a username is typed, and signs in with the key alone', async () => {
    const alice: FakeAccount = h.w.agent.account('alice', 'Password');
    await enrolKey(h.w, alice);
    alice.policy = 'KeyOnly';
    await saveHint(h.w.deps.store, { tenant: 'bench.work.avarok.net', cid: alice.cid, username: 'alice', keyFirst: true });
    renderLogin();
    fireEvent.click(await screen.findByTestId('login-passkey'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(alice.cid.toString()));
  });
});

describe('the touch prompt', () => {
  it('closes when the touch window runs out', async () => {
    const alice: FakeAccount = h.w.agent.account('alice', 'Password');
    await enrolKey(h.w, alice);
    alice.policy = 'KeyOnly';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLogin();
    fireEvent.click(screen.getByTestId('login-mode-key'));
    fireEvent.change(document.getElementById('username') as HTMLElement, { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('security-key-prompt')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(screen.queryByTestId('security-key-prompt')).toBeNull();
  });
});
