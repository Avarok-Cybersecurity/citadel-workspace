/**
 * The switch that was "Remember Credentials" (a plaintext password on the
 * agent) now offers passkey enrolment, and only where it can mean something:
 * not for an account that already has a key here, and not where WebAuthn
 * cannot run -- there the form says why and offers the password only.
 *
 * Rendered with plain props: no doubles at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginAdvancedOptions } from '../LoginAdvancedOptions';
import { DEFAULT_SECURITY_SETTINGS } from '../security-settings-defaults';
import type { PasskeyAccount } from '../passkey/usePasskeyAccount';

function renderWith(passkey: PasskeyAccount): void {
  render(
    <LoginAdvancedOptions
      isOpen={true} onToggle={vi.fn()} onConfigureSecurity={vi.fn()}
      securitySettings={{ ...DEFAULT_SECURITY_SETTINGS }} setSecuritySettings={vi.fn()}
      passkey={passkey}
    />,
  );
}

describe('the login form\'s passkey-enrol switch', () => {
  it('replaces Remember Credentials where passkeys can work', () => {
    renderWith({ available: true, hasKeys: false });
    expect(screen.getByRole('switch', { name: 'Add a security key after I sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Remember Credentials/i)).toBeNull();
  });

  it('is not offered for an account that already has a key here', () => {
    renderWith({ available: true, hasKeys: true });
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('without WebAuthn says why and offers no switch', () => {
    renderWith({ available: false, hasKeys: false });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/Your password still works/)).toBeInTheDocument();
  });
});
