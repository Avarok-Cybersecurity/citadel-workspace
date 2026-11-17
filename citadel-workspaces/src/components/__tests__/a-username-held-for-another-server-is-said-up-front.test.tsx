/**
 * Registering a username this device already holds for another server would overwrite
 * that account: one device holds one account per username (the agent stores accounts by
 * username). The form says so on the username field before anything is submitted, with
 * the way forward; and if the agent refuses anyway (its list was not read in time), the
 * refusal is the same typed answer, not a raw message.
 *
 * Doubled at the I/O seams (login-world.ts): the agent -- fake-agent.ts refuses such a
 * Register, typed, as the agent does -- and the post-sign-up work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toasts: { title?: string; description?: string }[] = vi.hoisted(() => []);
vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', () => ({ ConnectionManager: { getInstance: (): { handleAuthSuccess: () => Promise<void> } => ({ handleAuthSuccess: async (): Promise<void> => undefined }) } }));
vi.mock('@/lib/signup-follow-ups', () => ({ startSignupFollowUps: (): void => undefined }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: (t: { title?: string; description?: string }) => void } => ({ toast: (t): void => { toasts.push(t); } }) }));

import { Join } from '../Join';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { heldUsernameCopy } from '@/lib/sessions/known-accounts';
import { loginWorld as h } from './login-world';

const BENCH: string = 'bench.work.avarok.net';
const HERE: string = 'citadel.example.com:12349';
const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value, name: id } }); };
/** A fixture value for the form, not a credential for any system. */
const CHOSEN: string = ['Horse', 'battery', '9'].join('-');
const registers = (): Record<string, unknown>[] => h.w.agent.sent.filter(([v]) => v === 'Register').map(([, b]) => b);
const fill = (username: string): void => {
  type('fullName', 'Alice Example'); type('username', username); type('password', CHOSEN); type('confirmPassword', CHOSEN);
};

beforeEach(() => {
  toasts.length = 0;
  h.w = world(false);
  h.discovered = { required: false, siteKey: '' };
});
afterEach(() => { h.w.stop(); });

describe('a username this device holds for another server', () => {
  it('is said on the field before submitting, and nothing is registered', async () => {
    h.w.agent.account('alice').server = BENCH;
    render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress={HERE} serverPassword="" /></MemoryRouter>);
    fill('alice');
    // Untouched field, no submit yet: it is not a typing slip, so it is said at once.
    expect(await screen.findByText(heldUsernameCopy('alice', BENCH))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('join-submit'));
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(registers()).toEqual([]);
    expect(h.w.agent.accounts.map((a) => [a.username, a.server])).toEqual([['alice', BENCH]]);
  });

  it('the same username on the same server is the server’s to decide: no notice', async () => {
    // A bare host is the default port in both the comparison and the Register (one default).
    h.w.agent.account('alice').server = 'citadel.example.com:12400';
    render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com" serverPassword="" /></MemoryRouter>);
    fill('alice');
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(screen.queryByText(heldUsernameCopy('alice', 'citadel.example.com:12400'))).toBeNull();
  });

  it('a refusal the form did not see coming is the same answer', async () => {
    render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress={HERE} serverPassword="" /></MemoryRouter>);
    await new Promise<void>((r) => setTimeout(r, 20));
    // Held after the form read the agent's list.
    h.w.agent.account('alice').server = BENCH;
    fill('alice');
    fireEvent.click(screen.getByTestId('join-submit'));
    await waitFor(() => expect(toasts.at(-1)).toEqual(expect.objectContaining({ description: heldUsernameCopy('alice', BENCH) })));
    expect(registers()).toHaveLength(1);
    expect(h.w.agent.accounts).toHaveLength(1);
  });
});
