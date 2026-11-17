/**
 * Registering on a self-hosted server that asks for a human check: with no
 * HTTP discovery to ask, the server's `admission_required` refusal publishes
 * the check, and the form renders it and registers with its token.
 *
 * Doubled at the I/O seams, as registration-can-ask-for-a-human-check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', () => ({ ConnectionManager: { getInstance: (): { handleAuthSuccess: () => Promise<void> } => ({ handleAuthSuccess: async (): Promise<void> => undefined }) } }));
vi.mock('@/lib/signup-follow-ups', () => ({ startSignupFollowUps: (): void => undefined }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: () => void } => ({ toast: (): void => undefined }) }));

import { Join } from '../Join';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { ADMISSION_COPY } from '@/lib/admission/copy';
import { ALWAYS_PASS, installFakeTurnstile, type FakeTurnstile } from '../admission/__tests__/fake-turnstile';
import { loginWorld as h } from './login-world';

const IDENTITY: 'citadel-example' = 'citadel-example';
let turnstile: FakeTurnstile;
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value, name: id } }); };
/** A fixture value for the form, not a credential for any system. */
const CHOSEN: string = ['Horse', 'battery', '9'].join('-');
function join(): void {
  type('fullName', 'Alice Example'); type('username', 'alice'); type('password', CHOSEN); type('confirmPassword', CHOSEN);
  fireEvent.click(screen.getByTestId('join-submit'));
}
const registers = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Register').map(([, b]) => b);

beforeEach(() => {
  h.w = world(false);
  h.w.agent.admission.required = true;
  h.w.agent.admission.workspace = IDENTITY;
  h.discovered = null;
  turnstile = installFakeTurnstile();
  render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12349" serverPassword="" /></MemoryRouter>);
});
afterEach(() => { h.w.stop(); delete window.turnstile; });

describe('registering on a self-hosted server that asks for a human check', () => {
  it('shows the check the refusal published and registers with its token', async () => {
    h.w.agent.admission.challenge = { provider: 'turnstile', site_key: ALWAYS_PASS, identity: IDENTITY };
    join();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.required);
    await waitFor(() => expect(turnstile.issued).toHaveLength(1));
    expect(turnstile.rendered[0]).toMatchObject({ sitekey: ALWAYS_PASS, action: 'register', cData: IDENTITY });
    join();
    await waitFor(() => expect(h.w.agent.accounts.map((a) => a.username)).toContain('alice'));
    expect(registers().map((r) => r.admission_token)).toEqual([null, turnstile.issued[0]]);
  });

  it('ignores a malformed challenge: no widget, the plain "unavailable" answer', async () => {
    h.w.agent.admission.challenge = { provider: 'turnstile', site_key: '' };
    join();
    expect(await screen.findByTestId('admission-message')).toHaveTextContent(ADMISSION_COPY.unavailable);
    expect(turnstile.rendered).toEqual([]);
    expect(h.w.agent.accounts).toEqual([]);
  });
});
