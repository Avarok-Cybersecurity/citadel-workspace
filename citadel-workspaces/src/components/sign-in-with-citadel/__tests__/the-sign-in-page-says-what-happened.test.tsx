/**
 * The /sign-in page over fake ports, as a person sees it: the consent dialog is a page dialog with a
 * password field and three large words, Approve waits for a password, each refusal says its own
 * thing, the no-agent screen offers the install component, and a new person creates an identity.
 * Negative controls: rendering the dialog's words without the 28px class fails the size assertion;
 * a `window.confirm` approval fails the spy; dropping a message from EXPLANATIONS fails its row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SignInPage } from '@/pages/SignIn';
import { EXPLANATIONS } from '@/lib/sign-in-with-citadel/messages';
import type { SignInPorts } from '@/lib/sign-in-with-citadel/ports';
import { LINK, NO_IDENTITY, PROVEN, fakePorts, search, type Calls } from '@/lib/sign-in-with-citadel/__tests__/fake-ports';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function show(ports: SignInPorts, link: Record<string, string> = LINK): void {
  render(
    <MemoryRouter initialEntries={[`/sign-in${search(link)}`]}>
      <SignInPage ports={(): SignInPorts => ports} />
    </MemoryRouter>,
  );
}

describe('the consent dialog', () => {
  it('is a page dialog naming the app, the device and the identity, with three large words and a password field', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    show(fakePorts().ports);
    const dialog: HTMLElement = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('sign-in-consent-client')).toHaveTextContent('synchronized.work (synchronized.work)');
    expect(within(dialog).getByTestId('sign-in-consent-device').textContent).not.toBe('');
    expect(within(dialog).getByTestId('sign-in-consent-identity')).toHaveTextContent('3for-j6ft-ckvp-oy2r');
    const words: HTMLElement[] = within(within(dialog).getByTestId('sign-in-match-words')).getAllByRole('listitem');
    expect(words.map((w: HTMLElement) => w.textContent)).toEqual(['argue', 'occur', 'napkin']);
    for (const w of words) expect(w.className).toContain('text-[28px]');
    expect(within(dialog).getByLabelText(/unlock password/i)).toHaveAttribute('type', 'password');
    expect(within(dialog).getByText(/Only approve if you started this sign-in yourself/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps Approve disabled until a password is typed, then posts code and state to the return', async () => {
    const { ports, calls } = fakePorts();
    show(ports);
    const approve: HTMLElement = await screen.findByTestId('sign-in-approve');
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByTestId('sign-in-unlock-password'), { target: { value: 'correct horse' } });
    expect(approve).toBeEnabled();
    await act(async () => { fireEvent.click(approve); });
    await waitFor(() => expect(calls.posted).toEqual([{ action: LINK.return, fields: { code: PROVEN.code, state: LINK.state } }]));
    expect(await screen.findByTestId('sign-in-returning')).toBeInTheDocument();
  });

  it('Cancel closes it and posts nothing', async () => {
    const { ports, calls } = fakePorts();
    show(ports);
    fireEvent.click(await screen.findByTestId('sign-in-cancel'));
    expect(await screen.findByTestId('sign-in-cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.posted).toEqual([]);
    expect(calls.sign).toEqual([]);
  });

  it('says a wrong password inside the dialog', async () => {
    const { ports } = fakePorts({ sign: [{ ok: false, reason: 'wrong_password', message: 'no' }] });
    show(ports);
    fireEvent.change(await screen.findByTestId('sign-in-unlock-password'), { target: { value: 'nope' } });
    await act(async () => { fireEvent.click(screen.getByTestId('sign-in-approve')); });
    expect(await screen.findByTestId('sign-in-consent-error')).toHaveTextContent(EXPLANATIONS.wrong_password.body);
  });
});

const PROVE_CODES: readonly string[] = ['unknown_attempt', 'attempt_expired', 'attempt_proven', 'malformed_proof', 'bad_signature',
  'wrong_issuer', 'wrong_origin', 'audience_mismatch', 'nonce_mismatch', 'challenge_mismatch'];
const BEGIN_CODES: readonly string[] = ['malformed_link', 'unknown_client', 'return_not_allowlisted', 'issuer_unavailable', 'cross-origin', 'too-large', 'malformed-request'];

describe('each issuer refusal renders its own message', () => {
  it('no two codes share a message', () => {
    const bodies: string[] = [...PROVE_CODES, ...BEGIN_CODES].map((c: string) => EXPLANATIONS[c]?.title ?? '');
    expect(bodies.every((b: string) => b.length > 0)).toBe(true);
    expect(new Set(PROVE_CODES.map((c: string) => `${EXPLANATIONS[c].title} ${EXPLANATIONS[c].body}`)).size).toBe(PROVE_CODES.length);
  });

  it.each(PROVE_CODES)('prove: %s', async (code: string) => {
    show(fakePorts({ prove: { ok: false, code } }).ports);
    fireEvent.change(await screen.findByTestId('sign-in-unlock-password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByTestId('sign-in-approve')); });
    const failed: HTMLElement = await screen.findByTestId('sign-in-failed');
    expect(failed).toHaveAttribute('data-code', code);
    expect(failed).toHaveTextContent(EXPLANATIONS[code].title);
    expect(failed).toHaveTextContent(EXPLANATIONS[code].body);
  });

  it.each(BEGIN_CODES)('begin: %s', async (code: string) => {
    show(fakePorts({ begin: { ok: false, code } }).ports);
    const failed: HTMLElement = await screen.findByTestId('sign-in-failed');
    expect(failed).toHaveTextContent(EXPLANATIONS[code].title);
  });

  it('a restartable refusal offers Start again, which begins a new attempt', async () => {
    const { ports, calls } = fakePorts({ prove: { ok: false, code: 'attempt_expired' } });
    show(ports);
    fireEvent.change(await screen.findByTestId('sign-in-unlock-password'), { target: { value: 'pw' } });
    await act(async () => { fireEvent.click(screen.getByTestId('sign-in-approve')); });
    await act(async () => { fireEvent.click(await screen.findByTestId('sign-in-failed-action')); });
    await screen.findByRole('dialog');
    expect(calls.begin).toHaveLength(2);
  });
});

describe('a link that is refused', () => {
  it('names the reason and asks nobody anything', async () => {
    const { ports, calls } = fakePorts();
    show(ports, { ...LINK, return: 'https://evil.example/x' });
    expect(await screen.findByTestId('sign-in-refused')).toHaveTextContent(EXPLANATIONS.return_not_allowlisted.title);
    expect(calls.status).toEqual([]);
    expect(calls.begin).toEqual([]);
  });
});

describe('no agent', () => {
  it('shows the install component and Retry, and begins nothing', async () => {
    const { ports, calls } = fakePorts({ status: null });
    show(ports);
    const screenEl: HTMLElement = await screen.findByTestId('sign-in-no-agent');
    expect(within(screenEl).getByRole('heading', { name: 'Install the Citadel Agent' })).toBeInTheDocument();
    expect(within(screenEl).getByTestId('sign-in-retry')).toBeInTheDocument();
    expect(within(screenEl).getByTestId('agent-setup')).toBeInTheDocument();
    expect(calls.begin).toEqual([]);
  });
});

describe('a new person', () => {
  it('creates an identity, confirms the phrase, then reaches the same dialog', async () => {
    const { ports, calls } = fakePorts({ status: NO_IDENTITY });
    show(ports);
    await screen.findByTestId('sign-in-create-identity');
    const create: HTMLElement = screen.getByTestId('sign-in-create');
    fireEvent.change(screen.getByLabelText('Unlock password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'short' } });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Unlock password'), { target: { value: 'a long password' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'a long password' } });
    await act(async () => { fireEvent.click(create); });
    expect(calls.create).toEqual(['a long password']);
    const phrase: HTMLElement = await screen.findByTestId('sign-in-recovery-phrase');
    expect(within(phrase).getAllByRole('listitem')).toHaveLength(24);
    fireEvent.click(screen.getByTestId('sign-in-phrase-written'));
    for (const n of [4, 12, 21]) fireEvent.change(screen.getByLabelText(`Word ${n}`), { target: { value: `word${n - 1}` } });
    await act(async () => { fireEvent.click(screen.getByTestId('sign-in-phrase-confirm')); });
    const dialog: HTMLElement = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('sign-in-consent-identity')).toHaveTextContent('newi-dent-ityf-p234');
    expect((calls satisfies Calls).begin).toHaveLength(1);
  });
});
