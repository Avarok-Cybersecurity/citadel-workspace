/**
 * An account the agent no longer holds opens the ordinary sign-in, filled with
 * what is known and saying why -- never "Open here too", whose join the agent
 * refuses with "Session <cid> not found" for an account it does not hold.
 *
 * The agent's socket is stood in for by a greeting that declares it hosts
 * accounts (the case that used to route to the join); the dialogs and the
 * sign-in form are production code.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { TakeoverSignIn } from '../TakeoverSignIn';
import { signedOutSignIn } from '@/lib/sessions/sign-in-request';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

function show(onClose: () => void): void {
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <TakeoverSignIn request={signedOutSignIn('bob', 'wss://bench.work.avarok.net/')} onClose={onClose} />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

describe('signing in to an account the agent does not hold', () => {
  it('opens the sign-in form with the username filled and the reason shown', async () => {
    await greetAs(true);
    show((): void => {});
    expect(await screen.findByDisplayValue('bob', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('login-notice')).toHaveTextContent('bob on bench.work.avarok.net is signed out. Enter the password to sign in again.');
    expect(screen.queryByTestId('open-here-too')).toBeNull();
  });

  it('leaves the password for the user and puts the cursor there', async () => {
    await greetAs(true);
    show((): void => {});
    const password: HTMLElement = await screen.findByLabelText(/^password$/i, {}, { timeout: 5000 });
    expect(password).toHaveValue('');
    expect(document.activeElement).toBe(password);
  });

  it('closes on Escape', async () => {
    await greetAs(true);
    let closed: number = 0;
    show((): void => { closed += 1; });
    await screen.findByDisplayValue('bob', {}, { timeout: 5000 });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(closed).toBe(1);
  });
});
