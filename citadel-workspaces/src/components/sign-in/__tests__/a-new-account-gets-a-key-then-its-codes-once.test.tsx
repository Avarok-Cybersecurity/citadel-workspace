/**
 * After registration: an optional security key, then the recovery codes, shown
 * once, with Copy and Download, and Continue only after "I've saved these".
 *
 * Doubled at the I/O seams only: the agent (fake-agent.ts) and the
 * authenticator (passkey fakes), through the sign-in composition root; the
 * clipboard and object URLs, which jsdom does not implement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { World } from '@/lib/sign-in/__tests__/helpers';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

const h: { w: World } = vi.hoisted(() => ({ w: undefined as unknown as World }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), browserSignInDeps: (): World['deps'] => h.w.deps }));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), passkeysAvailableHere: (): boolean => true }));

import { PostRegistrationSteps } from '../PostRegistrationSteps';
import { SecurityKeyPrompt } from '../SecurityKeyPrompt';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { PRF_COPY } from '@/lib/sign-in/copy';

const CODES: string[] = ['CODE-0000', 'CODE-0001', 'CODE-0002'];
let alice: FakeAccount;
let onDone: ReturnType<typeof vi.fn>;
let clipboard: ReturnType<typeof vi.fn>;
const downloads: string[] = [];

function renderSteps(codes: readonly string[]): void {
  onDone = vi.fn();
  render(<><PostRegistrationSteps session={alice.cid} username="alice" serverAddress="bench.work.avarok.net"
    password="correct horse battery" recoveryCodes={codes} signIn={vi.fn()} onDone={onDone} /><SecurityKeyPrompt /></>);
}

beforeEach(() => {
  h.w = world(false);
  alice = h.w.agent.account('alice');
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: clipboard } });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:codes'), revokeObjectURL: vi.fn() });
  // jsdom cannot navigate; the download is observed as the click on a named link.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): void {
    downloads.push(this.download);
  });
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => { h.w.stop(); vi.restoreAllMocks(); });

describe('after an account is created', () => {
  it('adds a key with the server, then shows the codes', async () => {
    renderSteps(CODES);
    fireEvent.click(screen.getByTestId('add-security-key-continue'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    expect(await screen.findByTestId('recovery-codes')).toBeInTheDocument();
    expect(alice.keys).toHaveLength(1);
    expect(alice.policy).toBe('PasswordAndKey');
    expect(screen.getAllByTestId('recovery-code').map((li) => li.textContent)).toEqual(CODES);
  });

  it('lets the key be skipped, and the codes still come', async () => {
    renderSteps(CODES);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    expect(await screen.findByTestId('recovery-codes')).toBeInTheDocument();
    expect(h.w.agent.sent).toEqual([]);
  });

  it('holds Continue until the user says the codes are saved', async () => {
    renderSteps(CODES);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    const done: HTMLElement = await screen.findByTestId('recovery-codes-done');
    expect(done).toBeDisabled();
    fireEvent.click(done);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('recovery-codes-saved'));
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('copies every code, and never writes one to storage', async () => {
    renderSteps(CODES);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    fireEvent.click(await screen.findByTestId('recovery-codes-copy'));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    for (const code of CODES) expect(clipboard.mock.calls[0][0]).toContain(code);
    fireEvent.click(screen.getByTestId('recovery-codes-download'));
    expect(downloads).toContain('citadel-recovery-codes.txt');
    const stored: string = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
      + [...h.w.deps.store.data.values()].map((b) => new TextDecoder().decode(b)).join('');
    for (const code of CODES) expect(stored).not.toContain(code);
  });

  it('shows nothing, and opens the workspace, for a server without post-quantum sign-in', () => {
    renderSteps([]);
    expect(screen.queryByTestId('post-registration')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('refuses a key without PRF support before the server hears of it', async () => {
    h.w.authenticator.prfMode = 'none';
    renderSteps(CODES);
    fireEvent.click(screen.getByTestId('add-security-key-continue'));
    expect(await screen.findByTestId('add-security-key-error')).toHaveTextContent(PRF_COPY.notAdded);
    expect(h.w.agent.sent).toEqual([]);
  });

  it('says up front when this browser cannot make a key that signs in, and still lets the codes come', async () => {
    h.w.authenticator.browserHasNoPrf = true;
    renderSteps(CODES);
    expect(await screen.findByTestId('add-security-key-unsupported')).toHaveTextContent(PRF_COPY.unavailableHere);
    expect(screen.queryByTestId('add-security-key-continue')).toBeNull();
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    expect(await screen.findByTestId('recovery-codes')).toBeInTheDocument();
    expect(h.w.authenticator.createCalls).toEqual([]);
  });
});
