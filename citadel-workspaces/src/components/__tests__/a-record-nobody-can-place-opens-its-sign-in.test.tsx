/**
 * A stored account no server is known for (lib/connection/stored-server.ts) is handed to
 * SignInNeededWatcher, which opens its sign-in: username filled, unscoped, saying why, and
 * gone once closed. The hand-off is a store, so a reconnect that ran before the watcher
 * mounted is still shown.
 *
 * Production code throughout: the watcher, TakeoverSignIn and the sign-in form, as
 * a-signed-out-account-opens-its-sign-in does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { SignInNeededWatcher } from '../SignInNeededWatcher';
import { signInNeededFor } from '@/lib/sessions/sign-in-needed';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

const mount = (): void => {
  render(<MemoryRouter><ConfirmDialogProvider><SignInNeededWatcher /></ConfirmDialogProvider></MemoryRouter>);
};

afterEach(() => { act(() => { signInNeededFor.set(null); }); });

describe('an account nobody can place', () => {
  it('opens its sign-in when handed over, and closes it on Escape', async () => {
    await greetAs(true);
    mount();
    expect(screen.queryByTestId('login-notice')).toBeNull();
    act(() => { signInNeededFor.set('alice'); });
    expect(await screen.findByDisplayValue('alice', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('login-notice')).toHaveTextContent('alice is signed out. Enter the password to sign in again.');
    expect(screen.queryByTestId('login-scope')).toBeNull();
    // The overlay moves focus in and starts listening for Escape in one deferred effect pass;
    // the field can render before that pass runs, so focus arriving is the sign it listens.
    const dialog: HTMLElement = screen.getByRole('dialog');
    await waitFor(() => { expect(dialog).toContainElement(document.activeElement as HTMLElement); });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(signInNeededFor.get()).toBeNull();
  });

  it('shows a hand-off made before it mounted', async () => {
    await greetAs(true);
    signInNeededFor.set('bob');
    mount();
    expect(await screen.findByDisplayValue('bob', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
