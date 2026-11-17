import { describe, it, expect } from 'vitest';
import { render, screen, type RenderResult } from '@testing-library/react';
import { JoinFormFields } from '../JoinFormFields';
import { CREDENTIAL_LIMITS } from '@/lib/credential-rules';

/**
 * The strength meter must never certify a password the validator rejects.
 *
 * The maximum password length is 17 — shorter than what every password manager
 * generates by default. The meter rewarded length, so a 24-character generated
 * password showed four green bars and "Strong" while the field beside it turned
 * red with "17 characters or fewer". The meter and the rule contradicted each
 * other on screen, at the same moment, for exactly the users with the best
 * credential hygiene.
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
    const generated: "Xk9$mQ2#vL7@pR4!nT6&wZ" = 'Xk9$mQ2#vL7@pR4!nT6&wZ';
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
