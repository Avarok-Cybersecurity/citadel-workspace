/**
 * The notice a service failure puts in place of the workspace: the owner's sentence, the code
 * for its kind, and a Retry that does what it is handed.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServiceUnavailable } from '../ServiceUnavailable';
import { PolicyChoice } from '@/components/sign-in/PolicyChoice';
import { KEY_POLICY_RECONNECT_NOTE } from '@/lib/sign-in/copy';

describe('the outage notice', () => {
  it('says whose failure it is, shows the code of its kind, and retries', () => {
    const retry: () => void = vi.fn();
    render(<ServiceUnavailable kind="server-unreachable" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('The error is on us — please check back soon');
    expect(screen.getByTestId('service-unavailable-code').textContent).toBe('CW-SRV-UNREACHABLE');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows another kind another code, and never a stack trace', () => {
    render(<ServiceUnavailable kind="reconnect-slow" onRetry={(): void => undefined} />);
    expect(screen.getByTestId('service-unavailable-code').textContent).toBe('CW-LINK-SLOW');
    expect(screen.getByTestId('service-unavailable').textContent).not.toMatch(/\bat \w+ \(|Error:/);
  });
});

describe('choosing a policy that asks for a key', () => {
  const choice = (value: 'Password' | 'PasswordAndKey' | 'KeyOnly'): void => {
    render(<PolicyChoice id="t" value={value} options={['Password', 'PasswordAndKey', 'KeyOnly']} onChange={(): void => undefined} disabled={false} />);
  };

  it('says a dropped connection will ask for a sign-in again', () => {
    for (const policy of ['PasswordAndKey', 'KeyOnly'] as const) {
      choice(policy);
      expect(screen.getByTestId('t-policy-reconnect-note').textContent).toBe(KEY_POLICY_RECONNECT_NOTE);
      document.body.innerHTML = '';
    }
  });

  // The control: under the password alone the agent does reconnect by itself, so nothing is said.
  it('says nothing of it under the password alone', () => {
    choice('Password');
    expect(screen.queryByTestId('t-policy-reconnect-note')).toBeNull();
  });
});
