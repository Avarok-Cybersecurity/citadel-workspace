/**
 * After registration: an optional security key, then the 24-word recovery
 * phrase, shown once, with Copy and Download, and the workspace only after
 * three of its words are typed back.
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
import { fakePhrase } from '@/lib/sign-in/__tests__/fake-agent-recovery';
import { PHRASE_COPY } from '@/lib/recovery/copy';
import type { RecoverySecret } from '@/lib/recovery/secret';

const WORDS: string[] = fakePhrase(3);
const PHRASE: RecoverySecret = { kind: 'phrase', words: WORDS };
let alice: FakeAccount;
let onDone: ReturnType<typeof vi.fn>;
let clipboard: ReturnType<typeof vi.fn>;
const downloads: string[] = [];

function renderSteps(secret: RecoverySecret | null): void {
  onDone = vi.fn();
  render(<><PostRegistrationSteps session={alice.cid} username="alice" serverAddress="bench.work.avarok.net"
    password="correct horse battery" recoverySecret={secret} signIn={vi.fn()} onDone={onDone} /><SecurityKeyPrompt /></>);
}

/** Type back the words the check asks for: `wrong` types the next word instead at the first box. */
function typeBack(words: readonly string[], wrong: boolean): void {
  screen.getAllByTestId('recovery-phrase-check-word').forEach((box: HTMLElement, i: number) => {
    const at: number = Number(box.getAttribute('data-position'));
    fireEvent.change(box, { target: { value: wrong && i === 0 ? words[(at + 1) % words.length] + 'x' : words[at].toUpperCase() } });
  });
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
  it('adds a key with the server, then shows the 24 words in order', async () => {
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-continue'));
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    expect(await screen.findByTestId('recovery-phrase')).toBeInTheDocument();
    expect(alice.keys).toHaveLength(1);
    expect(alice.policy).toBe('PasswordAndKey');
    const drawn: string[] = screen.getAllByTestId('recovery-phrase-word').map((li) => li.lastElementChild?.textContent ?? '');
    expect(drawn).toEqual(WORDS);
  });

  it('lets the key be skipped, and the phrase still comes', async () => {
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    expect(await screen.findByTestId('recovery-phrase')).toBeInTheDocument();
    expect(h.w.agent.sent).toEqual([]);
  });

  it('opens the workspace only once three words are typed back right', async () => {
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    fireEvent.click(await screen.findByTestId('recovery-phrase-written'));
    expect(screen.getAllByTestId('recovery-phrase-check-word')).toHaveLength(3);
    const confirm: HTMLElement = screen.getByTestId('recovery-phrase-confirm');
    expect(confirm).toBeDisabled();
    typeBack(WORDS, true);
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent(PHRASE_COPY.confirmMismatch);
    expect(onDone).not.toHaveBeenCalled();
    typeBack(WORDS, false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('can show the phrase again from the check', async () => {
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    fireEvent.click(await screen.findByTestId('recovery-phrase-written'));
    fireEvent.click(screen.getByTestId('recovery-phrase-show-again'));
    expect(screen.getAllByTestId('recovery-phrase-word')).toHaveLength(24);
  });

  it('copies and downloads every word, and never writes one to storage', async () => {
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    fireEvent.click(await screen.findByTestId('recovery-phrase-copy'));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const copied: string = clipboard.mock.calls[0][0] as string;
    for (const word of WORDS) expect(copied).toContain(word);
    expect(copied).toContain('alice on bench.work.avarok.net');
    fireEvent.click(screen.getByTestId('recovery-phrase-download'));
    expect(downloads).toContain('citadel-recovery-phrase.txt');
    const stored: string = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
      + [...h.w.deps.store.data.values()].map((b) => new TextDecoder().decode(b)).join('');
    expect(stored).not.toContain(WORDS.slice(0, 3).join(' '));
    for (const word of new Set(WORDS)) expect(stored.includes(`"${word}"`)).toBe(false);
  });

  it('still shows an older server\'s codes, so none is lost', async () => {
    renderSteps({ kind: 'codes', words: ['CODE-0000', 'CODE-0001', 'CODE-0002'] });
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    expect(await screen.findByText(PHRASE_COPY.codesTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('recovery-phrase-written'));
    screen.getAllByTestId('recovery-phrase-check-word').forEach((box: HTMLElement) => {
      fireEvent.change(box, { target: { value: `CODE-000${box.getAttribute('data-position')}` } });
    });
    fireEvent.click(screen.getByTestId('recovery-phrase-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('shows nothing, and opens the workspace, for a server without post-quantum sign-in', () => {
    renderSteps(null);
    expect(screen.queryByTestId('post-registration')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('refuses a key without PRF support, declining the server\'s Enrol challenge, and adds nothing', async () => {
    h.w.authenticator.prfMode = 'none';
    renderSteps(PHRASE);
    fireEvent.click(screen.getByTestId('add-security-key-continue'));
    // The key is made inside the prompt's gesture, when the server's Enrol challenge asks for it.
    fireEvent.click(await screen.findByTestId('security-key-continue'));
    expect(await screen.findByTestId('add-security-key-error')).toHaveTextContent(PRF_COPY.notAdded);
    expect(h.w.agent.sent.map(([variant]) => variant)).toEqual(['SignInManagement', 'SecurityKeyDecline']);
    expect(alice.keys).toEqual([]);
  });

  it('says up front when this browser cannot make a key that signs in, and still lets the phrase come', async () => {
    h.w.authenticator.browserHasNoPrf = true;
    renderSteps(PHRASE);
    expect(await screen.findByTestId('add-security-key-unsupported')).toHaveTextContent(PRF_COPY.unavailableHere);
    expect(screen.queryByTestId('add-security-key-continue')).toBeNull();
    fireEvent.click(screen.getByTestId('add-security-key-skip'));
    expect(await screen.findByTestId('recovery-phrase')).toBeInTheDocument();
    expect(h.w.authenticator.createCalls).toEqual([]);
  });
});
