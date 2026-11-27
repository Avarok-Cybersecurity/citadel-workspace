/**
 * A registration that failed on the agent or server's side says why and offers Try again, which
 * runs the same attempt again. It used to be a toast with nothing to press.
 *
 * Doubled at the I/O seams (login-world.ts), as the other Join specs; the toast is recorded so its
 * action can be pressed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface Shown { title: string; action?: { label: string; onClick: () => void } }
const toasts: { shown: Shown[] } = vi.hoisted(() => ({ shown: [] }));
vi.mock('@/lib/websocket-service', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).websocketServiceDouble(orig));
vi.mock('@/lib/connection', () => ({ ConnectionManager: { getInstance: (): { handleAuthSuccess: () => Promise<void> } => ({ handleAuthSuccess: async (): Promise<void> => undefined }) } }));
vi.mock('@/lib/signup-follow-ups', () => ({ startSignupFollowUps: (): void => undefined }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).signInDouble(orig));
vi.mock('@/lib/admission', async (orig: () => Promise<Record<string, unknown>>) => (await import('./login-world')).admissionDouble(orig));
vi.mock('@/hooks/use-toast', () => {
  const toast = (t: Shown): { dismiss: () => void } => { toasts.shown.push(t); return { dismiss: (): void => undefined }; };
  return { toast, useToast: (): { toast: typeof toast } => ({ toast }) };
});

import { Join } from '../Join';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { loginWorld as h } from './login-world';

const type = (id: string, value: string): void => { fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value, name: id } }); };
const registers = (): number => h.w.agent.sent.filter(([v]) => v === 'Register').length;

beforeEach(() => { h.w = world(false); toasts.shown = []; });
afterEach(() => { h.w.stop(); h.discovered = null; });

describe('a failed registration', () => {
  it('offers Try again, which registers again', async () => {
    h.w.agent.failNextRegister = 'the server closed the connection';
    render(<MemoryRouter><Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12349" serverPassword="" /></MemoryRouter>);
    type('fullName', 'Alice Example'); type('username', 'alice'); type('password', 'Horse-battery-9'); type('confirmPassword', 'Horse-battery-9');
    fireEvent.click(screen.getByTestId('join-submit'));
    await waitFor(() => expect(toasts.shown.some((t) => t.action !== undefined)).toBe(true));
    const failure: Shown = toasts.shown.find((t) => t.action !== undefined) as Shown;
    expect(failure.action?.label).toBe('Try again');
    expect(registers()).toBe(1);

    failure.action?.onClick();
    await waitFor(() => expect(registers()).toBe(2));
    await waitFor(() => expect(h.w.agent.accounts.map((a) => a.username)).toContain('alice'));
  });
});
