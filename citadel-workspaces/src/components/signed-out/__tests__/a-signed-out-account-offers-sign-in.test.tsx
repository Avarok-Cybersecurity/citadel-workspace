/**
 * In Manage Accounts, a saved account the server signed out says so and offers "Sign in".
 *
 * It used to read as any other offline saved account, with "Switch", which is
 * the wrong word for an account that has to authenticate again. The row, the
 * copy and the matcher are the production ones; nothing is mocked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountRow } from '@/components/AccountRows';
import { SIGNED_OUT_COPY } from '../signed-out-copy';
import { signedOutReasonFor } from '../signed-out-match';
import type { SignedOutAccount } from '@/types/session-types';

afterEach(cleanup);

const REASON: string = 'CID not registered to this node';
const LIST: SignedOutAccount[] = [
  { cid: 7n, username: 'alice', reason: REASON },
  { cid: 9n, username: 'bob', reason: 'no answer from the server in 600s' },
];

function row(signedOut: string | null, onSwitch: () => void = vi.fn()): void {
  render(<AccountRow username="alice" host="ws.example" current={false} live={false} lastConnected={null} signedOut={signedOut} onSwitch={onSwitch} onDelete={null} />);
}

describe('a signed-out saved account', () => {
  it('says the server signed it out, gives the reason, and offers Sign in', async (): Promise<void> => {
    const onSwitch: () => void = vi.fn();
    row(REASON, onSwitch);
    const note: HTMLElement = screen.getByTestId('account-signed-out');
    expect(note.textContent).toContain(SIGNED_OUT_COPY.status);
    expect(note.textContent).toContain(REASON);
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: SIGNED_OUT_COPY.signIn }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('is an ordinary row when the server did not sign it out', () => {
    row(null);
    expect(screen.queryByTestId('account-signed-out')).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch' })).toBeTruthy();
  });
});

describe('matching a saved account to its sign-out', () => {
  it('matches by CID, which is permanent per account', () => {
    expect(signedOutReasonFor({ cid: 7n, username: 'someone-else' }, LIST)).toBe(REASON);
    expect(signedOutReasonFor({ cid: 8n, username: 'alice' }, LIST)).toBeNull();
  });

  it('falls back to the username for a saved record without a CID', () => {
    expect(signedOutReasonFor({ username: 'alice' }, LIST)).toBe(REASON);
    expect(signedOutReasonFor({ username: 'carol' }, LIST)).toBeNull();
  });
});
