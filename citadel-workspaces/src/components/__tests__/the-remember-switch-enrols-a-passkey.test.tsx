/**
 * The switch that was "Remember Credentials" (a plaintext password on the
 * agent) now offers passkey enrolment, and only where it can mean something:
 * not where WebAuthn cannot run -- there the form says why and offers the
 * password only.
 *
 * Rendered with plain props: no doubles at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginAdvancedOptions } from '../LoginAdvancedOptions';
import { DEFAULT_SECURITY_SETTINGS } from '../security-settings-defaults';

function renderWith(passkeysAvailable: boolean): void {
  render(
    <LoginAdvancedOptions
      isOpen={true} onToggle={vi.fn()} onConfigureSecurity={vi.fn()}
      securitySettings={{ ...DEFAULT_SECURITY_SETTINGS }} setSecuritySettings={vi.fn()}
      passkeysAvailable={passkeysAvailable}
    />,
  );
}

describe('the login form\'s passkey-enrol switch', () => {
  it('replaces Remember Credentials where passkeys can work', () => {
    renderWith(true);
    expect(screen.getByRole('switch', { name: 'Add a security key after I sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Remember Credentials/i)).toBeNull();
  });

  it('without WebAuthn says why and offers no switch', () => {
    renderWith(false);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/Your password still works/)).toBeInTheDocument();
  });
});
