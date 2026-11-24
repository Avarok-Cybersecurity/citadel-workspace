/**
 * The device's "stay signed in" choice: four presets, a working day until the user chooses,
 * kept in this browser, and what every sign-in from it asks the workspace for.
 *
 * Control: send `resume_lifetime_s: null` from auth-operations.ts, and the last test fails.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StaySignedInSection } from '../StaySignedInSection';
import { INITIAL_RESUME_LIFETIME, loadResumeLifetime, RESUME_LIFETIME_CHOICES, resumeLifetimeOf, saveResumeLifetime } from '@/lib/resume/lifetime';
import { AuthOperations } from '@/lib/websocket/auth-operations';

describe('how long this device stays signed in', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('offers an hour, eight hours, a day and a week, and starts at eight hours', () => {
    expect([...RESUME_LIFETIME_CHOICES]).toEqual([3600, 28800, 86400, 604800]);
    expect(INITIAL_RESUME_LIFETIME).toBe(28800);
    expect(loadResumeLifetime()).toBe(28800);
    render(<StaySignedInSection />);
    expect(screen.getByTestId('stay-signed-in-28800').getAttribute('data-state')).toBe('checked');
    for (const label of ['1 hour', '8 hours', '24 hours', '7 days']) expect(screen.getByText(label)).toBeTruthy();
  });

  it('keeps what the user picks, here and for the next page', () => {
    render(<StaySignedInSection />);
    fireEvent.click(screen.getByTestId('stay-signed-in-604800'));
    expect(screen.getByTestId('stay-signed-in-604800').getAttribute('data-state')).toBe('checked');
    expect(loadResumeLifetime()).toBe(604800);
    cleanup();
    render(<StaySignedInSection />);
    expect(screen.getByTestId('stay-signed-in-604800').getAttribute('data-state')).toBe('checked');
  });

  it('reads anything that is not a preset as the initial one', () => {
    for (const stored of [null, '', '0', '12345', '-3600', 'a week', '604800.5']) expect(resumeLifetimeOf(stored), String(stored)).toBe(28800);
    expect(resumeLifetimeOf('3600')).toBe(3600);
  });

  it('is what a sign-in from this device asks the workspace for', async () => {
    saveResumeLifetime(86400);
    const sent: unknown[] = [];
    const auth: AuthOperations = new AuthOperations({
      init: async (): Promise<void> => undefined,
      sendRequest: async (request: unknown): Promise<void> => { sent.push(request); },
      claimSession: async (): Promise<unknown> => null,
      disconnect: async (): Promise<void> => undefined,
    });
    await auth.connect('00000000-0000-4000-8000-000000000001', 'alice', 'acme.example', { password: 'pw', securityKey: false, admissionToken: null });
    const connect: Record<string, unknown> = (sent[0] as { Connect: Record<string, unknown> }).Connect;
    expect(connect.resume_lifetime_s).toBe(86400);
  });
});
