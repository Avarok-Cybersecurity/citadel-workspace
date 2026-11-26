import { describe, it, expect } from 'vitest';
import { render, screen, type RenderResult } from '@testing-library/react';
import { JoinFormFields } from '../JoinFormFields';
import { CREDENTIAL_LIMITS } from '@/lib/credential-rules';

/**
 * The strength meter must never certify a password the validator rejects.
 *
 * The meter rewards length, so when the maximum was 17 a 24-character generated
 * password showed four green bars and "Strong" while the field beside it turned
 * red with "17 characters or fewer". The meter and the rule contradicted each
 * other on screen, at the same moment. Any password past the maximum (now 64)
 * must read "Not accepted", however strong it is otherwise.
 */

const renderWith = (password: string): RenderResult =>
  render(
    <JoinFormFields
      formData={{ fullName: 'Test User', username: 'testuser', password, confirmPassword: password }}
      onChange={() => {}}
    />
  );

describe('password strength meter', () => {
  it('does not call an over-length password strong', () => {
    // Strong by every other measure — case mix, digit, symbol — and too long.
    // 65 characters: one past the maximum.
    const generated: string = `${'Aa1!'.repeat(16)}z`;
    expect(generated.length).toBe(65);
    expect(generated.length).toBeGreaterThan(CREDENTIAL_LIMITS.password.max);

    renderWith(generated);

    expect(screen.queryByText('Strong')).toBeNull();
    expect(screen.getByText('Not accepted')).toBeInTheDocument();
  });

  it('still calls an acceptable strong password strong', () => {
    const good: "Xk9$mQ2#vL7@" = 'Xk9$mQ2#vL7@'; // 12 chars: within range, all character classes
    expect(good.length).toBeLessThanOrEqual(CREDENTIAL_LIMITS.password.max);
    expect(good.length).toBeGreaterThanOrEqual(CREDENTIAL_LIMITS.password.min);

    renderWith(good);

    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  it('calls a strong password at the 64-character maximum strong', () => {
    const atMax: string = 'Aa1!'.repeat(16);
    expect(atMax.length).toBe(64);

    renderWith(atMax);

    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.queryByText('Not accepted')).toBeNull();
  });

  it('states the length limit before the user can break it', () => {
    renderWith('');

    // The hint must be present with no input at all — an inline error after the
    // fact still wastes a generated password.
    expect(
      screen.getByText(
        `${CREDENTIAL_LIMITS.password.min}–${CREDENTIAL_LIMITS.password.max} characters, no spaces`
      )
    ).toBeInTheDocument();
  });
});
