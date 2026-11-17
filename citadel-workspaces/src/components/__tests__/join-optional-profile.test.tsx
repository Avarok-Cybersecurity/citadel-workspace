/**
 * The Profile step offers a picture, an email and a job title, says who will
 * see them, and never lets them stand between the user and Join.
 *
 * `useJoinRegistration` is replaced (it needs a backend to do anything); the
 * form and the optional section rendered here are the real components.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { JoinRegistration } from '../join-registration-shape';
import { Join } from '../Join';
import { BLANK_JOIN_FORM } from '../join-form-blank';

let registration: JoinRegistration;

vi.mock('../useJoinRegistration', () => ({
  useJoinRegistration: (): JoinRegistration => registration,
}));

function renderJoin(formData: Partial<JoinRegistration['formData']>): { onOptional: ReturnType<typeof vi.fn> } {
  const onOptional: ReturnType<typeof vi.fn> = vi.fn();
  registration = {
    formData: { ...BLANK_JOIN_FORM, ...formData },
    isRegistering: false,
    showNotInitializedModal: false,
    showConnectModal: false,
    connectStatus: 'connecting',
    handleInputChange: vi.fn(),
    handleOptionalChange: onOptional as unknown as JoinRegistration['handleOptionalChange'],
    handleBlur: vi.fn(),
    fieldErrors: { fullName: null, username: null, password: null, confirmPassword: null },
    handleSubmit: vi.fn(),
    handleConnectModalComplete: vi.fn(),
    handleReturnToLogin: vi.fn(),
    recoveryCodes: [],
    awaitingSignIn: null,
    finishSignIn: vi.fn(),
  };
  render(
    <MemoryRouter>
      <Join onNext={vi.fn()} onBack={vi.fn()} serverAddress="citadel.example.com:12400" serverPassword="" />
    </MemoryRouter>,
  );
  return { onOptional };
}

describe('the Profile step’s optional details', () => {
  it('offers a picture, an email and a job title, and says members can see them', () => {
    renderJoin({});
    expect(screen.getByRole('button', { name: 'Upload profile picture' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Job title')).toBeTruthy();
    expect(screen.getByText(/picture, email and job title are visible to members of this workspace/)).toBeTruthy();
  });

  it('reports what is typed to the registration state', () => {
    const { onOptional } = renderJoin({});
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Engineer' } });
    expect(onOptional).toHaveBeenCalledWith('title', 'Engineer');
  });

  it('shows a malformed email as an error without disabling Join', () => {
    renderJoin({ email: 'not-an-email' });
    const email: HTMLElement = screen.getByLabelText('Email');
    expect(email.getAttribute('aria-invalid')).toBeNull(); // not before the field is left
    fireEvent.blur(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Enter an email like/)).toBeTruthy();
    const join: HTMLButtonElement = screen.getByTestId('join-submit') as HTMLButtonElement;
    expect(join.disabled).toBe(false);
  });
});
