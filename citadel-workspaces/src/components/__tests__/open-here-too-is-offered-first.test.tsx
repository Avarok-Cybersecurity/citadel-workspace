/**
 * A session another window holds is offered as "Open here too" -- both windows
 * live -- with moving it as the choice beside it.
 *
 * The agent's socket is stood in for by a greeting and a declaration answer;
 * the dialogs and the sign-in form are production code.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { TakeoverSignIn } from '../TakeoverSignIn';
import { heldElsewhereSignIn } from '@/lib/sessions/sign-in-request';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

function show(): void {
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <TakeoverSignIn request={heldElsewhereSignIn('alice0924')} onClose={(): void => {}} />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

describe('a session another window holds', () => {
  it('is offered here too when the agent hosts it, and can still be moved instead', async () => {
    await greetAs();
    show();
    expect(await screen.findByRole('heading', { name: 'Open alice0924 here too' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open here too' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    expect(screen.getByRole('button', { name: 'Open here too' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move it here instead' }));
    expect(await screen.findByDisplayValue('alice0924', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
