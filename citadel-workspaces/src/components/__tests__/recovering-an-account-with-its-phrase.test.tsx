/**
 * "Forgot your password? Recover your account" on the sign-in form: the username, its server and
 * the 24 words, checked before anything is sent; then the recovery console, its tasks, and either
 * signing out or signing in with the new password.
 *
 * Doubled at the same I/O seams as the other sign-in form tests (login-world.ts): the agent behind
 * the REAL AuthOperations and the message bus, the authenticator, and the IndexedDB / workspace /
 * ILM work a signed-in session starts (spies, to prove the console starts none of it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).connectionDouble(orig));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).tabContextDouble(orig));
vi.mock('@/lib/post-auth-setup', async () => ({ postAuthSetup: (await import('./login-world')).loginWorld.postAuth }));
vi.mock('@/lib/session-startup-service', () => ({}));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).passkeyDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));

import { Login } from '../Login';
import { SecurityKeyPromptHost as SecurityKeyPrompt } from '../sign-in/SecurityKeyPromptHost';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { loginWorld as h } from './login-world';
import { CONSOLE_COPY } from '@/lib/recovery/copy';

let onNext: ReturnType<typeof vi.fn>;
let alice: FakeAccount;
const SERVER: string = 'bench.work.avarok.net';

function renderLogin(): void {
  onNext = vi.fn();
  render(<MemoryRouter><Login onNext={onNext} onCancel={() => {}} initialUsername={undefined} /><SecurityKeyPrompt /></MemoryRouter>);
}
const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const type = (id: string, value: string): void => { fireEvent.change(field(id), { target: { value } }); };
const recovers = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'RecoverAccount').map(([, b]) => b);

/** Open "Recover account" and fill it: the phrase pasted whole into box `pasteAt`. */
async function fillRecovery(phrase: string, pasteAt: number): Promise<void> {
  renderLogin();
  fireEvent.click(screen.getByTestId('login-recover-account'));
  await screen.findByTestId('recover-account');
  type('recover-username', 'alice');
  type('recover-server', SERVER);
  fireEvent.paste(field(`recovery-word-${pasteAt}`), { clipboardData: { getData: (): string => phrase } });
}
async function recoverToConsole(): Promise<void> {
  await fillRecovery(alice.phrase.join(' '), 0);
  fireEvent.click(screen.getByTestId('recover-submit'));
  await screen.findByTestId('recovery-console');
}

beforeEach(() => {
  h.w = world(false);
  alice = h.w.agent.account('alice');
  h.postAuth.mockReset();
  h.messaging.mockReset().mockResolvedValue(true);
});
afterEach(() => h.w.stop());

describe('the recover form', () => {
  it('fills all 24 boxes from a phrase pasted into any of them', async () => {
    await fillRecovery(alice.phrase.map((w: string, i: number) => `${i + 1}. ${w}`).join('\n'), 9);
    expect(screen.getAllByTestId('recover-phrase-word').map((i) => (i as HTMLInputElement).value)).toEqual(alice.phrase);
  });

  it('sends nothing for a missing username, and says so at the field', async () => {
    await fillRecovery(alice.phrase.join(' '), 0);
    type('recover-username', '  ');
    fireEvent.click(screen.getByTestId('recover-submit'));
    expect(screen.getByTestId('recover-error')).toHaveTextContent('Enter your username.');
    expect(field('recover-username')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(field('recover-username'));
    expect(recovers()).toEqual([]);
  });

  it('sends nothing for a word not on the list, names it, and puts the cursor there', async () => {
    const typo: string[] = [...alice.phrase];
    typo[6] = 'citadelx';
    await fillRecovery(typo.join(' '), 0);
    fireEvent.click(screen.getByTestId('recover-submit'));
    expect(screen.getByTestId('recover-error')).toHaveTextContent("Word 7 isn't a recovery-phrase word.");
    expect(document.activeElement).toBe(field('recovery-word-6'));
    expect(field('recovery-word-6')).toHaveAttribute('aria-invalid', 'true');
    expect(field('recovery-word-5')).not.toHaveAttribute('aria-invalid');
    expect(recovers()).toEqual([]);
  });

  it('marks a word not on the list once the box is left, not while it is typed', async () => {
    renderLogin();
    fireEvent.click(screen.getByTestId('login-recover-account'));
    await screen.findByTestId('recover-account');
    type('recovery-word-3', 'aban');
    expect(field('recovery-word-3')).not.toHaveAttribute('aria-invalid');
    fireEvent.blur(field('recovery-word-3'));
    expect(field('recovery-word-3')).toHaveAttribute('aria-invalid', 'true');
    expect(field('recovery-word-3').getAttribute('aria-describedby')).toContain('recovery-word-3-error');
    expect(document.getElementById('recovery-word-3-error')).toHaveTextContent('Word 4, "aban", isn\'t a recovery-phrase word.');
    type('recovery-word-3', 'abandon');
    expect(field('recovery-word-3')).not.toHaveAttribute('aria-invalid');
  });

  it('shows the agent\'s refusal of a wrong phrase, and opens no console', async () => {
    const wrong: string[] = [...alice.phrase].reverse();
    await fillRecovery(wrong.join(' '), 0);
    fireEvent.click(screen.getByTestId('recover-submit'));
    expect(await screen.findByTestId('recover-error')).toHaveTextContent(/authentication failed/i);
    expect(recovers()).toHaveLength(1);
    expect(screen.queryByTestId('recovery-console')).toBeNull();
    expect(screen.getByTestId('recover-submit')).toBeEnabled();
  });

  it('goes back to the sign-in form', async () => {
    renderLogin();
    fireEvent.click(screen.getByTestId('login-recover-account'));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument();
  });
});

describe('the recovery console', () => {
  it('opens instead of the workspace, and says when other devices were signed out', async () => {
    alice.heldHere = false;
    await recoverToConsole();
    expect(screen.getByTestId('recovery-console')).toHaveAttribute('data-view', 'welcome');
    expect(screen.getByTestId('recovery-console-devices-signed-out')).toHaveTextContent(CONSOLE_COPY.devicesSignedOut);
    expect(onNext).not.toHaveBeenCalled();
    expect(h.postAuth).not.toHaveBeenCalled();
    expect(h.messaging).not.toHaveBeenCalled();
  });

  it('says nothing about other devices when this one already held the account', async () => {
    await recoverToConsole();
    expect(screen.queryByTestId('recovery-console-devices-signed-out')).toBeNull();
  });

  it('holds Finish until a task is done, and marks the tasks done', async () => {
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    expect(screen.getByTestId('recovery-console-done')).toBeDisabled();
    fireEvent.click(screen.getByTestId('recovery-task-policy'));
    fireEvent.click(await screen.findByTestId('console-policy-PasswordAndKey'));
    expect(screen.getByTestId('console-policy-save')).toBeEnabled();
    alice.keys.push({ id: 11, credentialId: [1], label: 'Spare', prf: 'x' });
    fireEvent.click(screen.getByTestId('console-policy-save'));
    expect(await screen.findByTestId('recovery-task-policy')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('recovery-task-password')).not.toHaveAttribute('data-done');
    expect(alice.policy).toBe('PasswordAndKey');
    fireEvent.click(screen.getByTestId('recovery-console-done'));
    expect(screen.getByTestId('recovery-console')).toHaveAttribute('data-view', 'finish');
    expect(screen.getByTestId('recovery-console-finish')).toHaveTextContent(CONSOLE_COPY.finishSignOut);
    expect(screen.queryByTestId('recovery-console-continue')).toBeNull();
  });

  it('gives every element in each task a test id of its own', async () => {
    alice.keys.push({ id: 11, credentialId: [1], label: 'Spare', prf: 'x' });
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    for (const task of ['password', 'credentials', 'policy', 'phrase'] as const) {
      fireEvent.click(screen.getByTestId(`recovery-task-${task}`));
      await waitFor(() => expect(screen.queryByTestId('recovery-console-back')).not.toBeNull());
      await waitFor(() => expect(screen.getByTestId('recovery-console').querySelector('.animate-spin')).toBeNull());
      const ids: string[] = [...screen.getByTestId('recovery-console').querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid') ?? '');
      expect(ids.filter((id: string, i: number) => ids.indexOf(id) !== i && id !== 'console-credential' && id !== 'console-credential-remove'), task).toEqual([]);
      fireEvent.click(screen.getByTestId('recovery-console-back'));
    }
  });

  it('removes a lost key from the list', async () => {
    alice.keys.push({ id: 11, credentialId: [1], label: 'Lost key', prf: 'x' });
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    fireEvent.click(screen.getByTestId('recovery-task-credentials'));
    const rows: HTMLElement[] = await screen.findAllByTestId('console-credential');
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Lost key'), expect.stringContaining('Recovery phrase')]));
    // Only a key can be removed: one Remove button, on the key's row.
    expect(screen.getAllByTestId('console-credential-remove')).toHaveLength(1);
    fireEvent.click(within(rows.find((r) => r.textContent?.includes('Lost key')) as HTMLElement).getByTestId('console-credential-remove'));
    await waitFor(() => expect(alice.keys).toEqual([]));
    expect(screen.getByTestId('console-credentials-status')).toHaveTextContent('Removed Lost key.');
  });

  it('refuses two passwords that differ, and a password the rules refuse, sending nothing', async () => {
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    fireEvent.click(screen.getByTestId('recovery-task-password'));
    type('console-password', 'lanternharbor');
    type('console-password-again', 'lanternharbour');
    fireEvent.click(screen.getByTestId('console-password-save'));
    expect(await screen.findByText(CONSOLE_COPY.passwordMismatch)).toBeInTheDocument();
    type('console-password', 'has space in it');
    type('console-password-again', 'has space in it');
    fireEvent.click(screen.getByTestId('console-password-save'));
    expect(await screen.findByText(/space/i)).toBeInTheDocument();
    expect(screen.queryByText(CONSOLE_COPY.passwordMismatch)).toBeNull();
    expect(h.w.agent.sent.some(([v, b]) => v === 'SignInManagement' && typeof b.op === 'object' && b.op !== null && 'SetPassword' in b.op)).toBe(false);
    expect(alice.password).toBe('correct horse battery');
  });

  it('sets a new password, then signs in with it and opens the workspace', async () => {
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    fireEvent.click(screen.getByTestId('recovery-task-password'));
    type('console-password', 'meadowlantern');
    type('console-password-again', 'meadowlantern');
    fireEvent.click(screen.getByTestId('console-password-save'));
    expect(await screen.findByTestId('recovery-task-password')).toHaveAttribute('data-done', 'true');
    expect(alice.password).toBe('meadowlantern');
    fireEvent.click(screen.getByTestId('recovery-console-done'));
    expect(screen.getByTestId('recovery-console-finish')).toHaveTextContent(CONSOLE_COPY.finishSignedIn);
    fireEvent.click(screen.getByTestId('recovery-console-continue'));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(alice.cid.toString()));
    expect(h.w.agent.recoverySessions.size).toBe(0);
    const connect: Record<string, unknown> | undefined = h.w.agent.sent.find(([v]) => v === 'Connect')?.[1];
    expect(new TextDecoder().decode(Uint8Array.from(connect?.password as number[]))).toBe('meadowlantern');
  });

  it('makes a new phrase, shows it once, and checks it before the task is done', async () => {
    const old: string = alice.phrase.join(' ');
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-begin'));
    fireEvent.click(screen.getByTestId('recovery-task-phrase'));
    fireEvent.click(screen.getByTestId('console-phrase-make'));
    const shown: string[] = (await screen.findAllByTestId('recovery-phrase-word')).map((li) => li.lastElementChild?.textContent ?? '');
    expect(shown).toEqual(alice.phrase);
    expect(shown.join(' ')).not.toBe(old);
    fireEvent.click(screen.getByTestId('recovery-phrase-written'));
    screen.getAllByTestId('recovery-phrase-check-word').forEach((box: HTMLElement) => {
      fireEvent.change(box, { target: { value: shown[Number(box.getAttribute('data-position'))] } });
    });
    fireEvent.click(screen.getByTestId('recovery-phrase-confirm'));
    expect(await screen.findByTestId('recovery-task-phrase')).toHaveAttribute('data-done', 'true');
  });

  it('signs out back to the sign-in form, ending the console session', async () => {
    await recoverToConsole();
    fireEvent.click(screen.getByTestId('recovery-console-sign-out'));
    expect(await screen.findByTestId('login-submit')).toBeInTheDocument();
    expect(h.w.agent.recoverySessions.size).toBe(0);
    expect(onNext).not.toHaveBeenCalled();
  });
});
