import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../Login';

/**
 * An account link with no live session lands here: the username filled in,
 * the password empty and focused. Rendered for real -- no module is mocked;
 * nothing is submitted, so nothing reaches the agent.
 */
function renderLogin(initialUsername: string | undefined): void {
  render(
    <MemoryRouter>
      <Login onNext={() => {}} onCancel={() => {}} initialUsername={initialUsername} />
    </MemoryRouter>,
  );
}

describe('the sign-in form opened from an account link', () => {
  it('starts with the linked username and focuses the password', () => {
    renderLogin('alice');
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('alice');
    const password: HTMLInputElement = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(document.activeElement).toBe(password);
  });

  it('starts empty, focus where the dialog puts it, for an ordinary sign-in', () => {
    renderLogin(undefined);
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).not.toBe(screen.getByLabelText('Password'));
  });
});
