/**
 * Registration on a workspace that asks for a human check: the check is shown,
 * its token rides in Register as `admission_token`, and a refusal is answered
 * on the check rather than as a generic "registration failed" toast.
 *
 * Doubled at the I/O seams (login-world.ts), plus ConnectionManager's session
 * store (IndexedDB) and the post-signup writes (profile, Terms and diagnostics: workspace requests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toasts: { titles: string[] } = vi.hoisted(() => ({ titles: [] }));
vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', () => ({ ConnectionManager: { getInstance: (): { handleAuthSuccess: () => Promise<void> } => ({ handleAuthSuccess: async (): Promise<void> => undefined }) } }));
vi.mock('@/lib/signup-follow-ups', () => ({ startSignupFollowUps: (): void => undefined }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: (t: { title: string }) => void } => ({ toast: (t: { title: string }): void => { toasts.titles.push(t.title); } }) }));

import { Join } from '../Join';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

let turnstile: FakeTurnstile;
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value, name: id } }); };
function fillAndJoin(): void {
  type('fullName', 'Alice Example'); type('username', 'alice'); type('password', 'Horse-battery-9'); type('confirmPassword', 'Horse-battery-9');
  fireEvent.click(screen.getByTestId('join-submit'));
}
/** bench.work.avarok.net is Avarok-hosted: Join puts the Terms of Use to the person first. */
async function register(): Promise<void> {
  fillAndJoin();
  fireEvent.click(await screen.findByTestId('terms-agree'));
  fireEvent.click(screen.getByTestId('terms-accept'));
}
const registers = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Register').map(([, b]) => b);

function renderJoin(): void {
  render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="bench.work.avarok.net" serverPassword="" /></MemoryRouter>);
}

beforeEach(() => {
  h.w = world(false);
  h.w.agent.admission.required = true;
  turnstile = installFakeTurnstile();
  toasts.titles = [];
});
afterEach(() => { h.w.stop(); delete window.turnstile; h.discovered = null; });

describe('registering where a human check is required', () => {
  it('shows the check from discovery and sends its token in Register', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderJoin();
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    // Bound to the workspace being joined: the server refuses a token rendered for another.
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'register', cData: 'bench' });
    await register();
    await waitFor(() => expect(h.w.agent.accounts.map((a) => a.username)).toContain('alice'));
    expect(registers()[0]).toMatchObject({ admission_token: turnstile.issued[0] });
    expect(turnstile.rendered[0]).toMatchObject({ cData: 'bench' });
  });

  it('registers nothing until the Terms of Use are accepted in the dialog, and nothing at all if it is cancelled', async () => {
    renderJoin();
    fillAndJoin();
    expect(await screen.findByTestId('terms-acceptance-modal')).toBeInTheDocument();
    expect(screen.getByTestId('terms-accept')).toBeDisabled();
    fireEvent.click(screen.getByTestId('terms-cancel'));
    await waitFor(() => expect(screen.queryByTestId('terms-acceptance-modal')).toBeNull());
    expect(registers()).toEqual([]);
    expect(h.w.agent.accounts).toEqual([]);
    await register();
    await waitFor(() => expect(registers()).toHaveLength(1));
  });

  it('puts no dialog to someone joining a server Avarok does not host, and registers at once', async () => {
    render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12349" serverPassword="" /></MemoryRouter>);
    expect(screen.queryByTestId('join-terms-note')).toBeNull();
    fillAndJoin();
    await waitFor(() => expect(registers()).toHaveLength(1));
    expect(screen.queryByTestId('terms-acceptance-modal')).toBeNull();
  });

  it('signs in with a fresh check after registering, as the next step and not as an error', async () => {
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    renderJoin();
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    await register();
    // The codes come first: the account exists, and they are shown once.
    fireEvent.click(await screen.findByTestId('recovery-codes-saved'));
    fireEvent.click(screen.getByTestId('recovery-codes-done'));
    const issuedBefore: number = turnstile.issued.length;
    expect(await screen.findByTestId('finish-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('admission-message')).toBeNull();
    expect(toasts.titles.filter((t) => /fail|error/i.test(t))).toEqual([]);
    await waitFor(() => expect(turnstile.rendered.at(-1)).toMatchObject({ action: 'sign-in', cData: 'bench' }));
    await waitFor(() => expect(turnstile.issued.length).toBeGreaterThan(issuedBefore));
    const fresh: string | undefined = turnstile.issued.at(-1);
    fireEvent.click(screen.getByTestId('finish-sign-in-continue'));
    // Signed in: the optional key step, then the workspace.
    expect(await screen.findByTestId('add-security-key')).toBeInTheDocument();
    const connect: Record<string, unknown> | undefined = h.w.agent.sent.find(([v]) => v === 'Connect')?.[1];
    // The sign-in widget's own token: fresh, never the one Register spent.
    expect(connect).toMatchObject({ username: 'alice', admission_token: fresh });
    expect(connect?.admission_token).not.toBe(registers()[0].admission_token);
  });

  it('answers a refusal on the check, not with a failure toast, when discovery could not say', async () => {
    renderJoin();
    await register();
    h.discovered = { required: true, siteKey: ALWAYS_PASS };
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    expect(toasts.titles).toEqual([]);
    expect(registers()[0]).toMatchObject({ admission_token: null });
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    await register();
    await waitFor(() => expect(h.w.agent.accounts.map((a) => a.username)).toContain('alice'));
    expect(registers()[1]).toMatchObject({ admission_token: turnstile.issued[0] });
  });
});
