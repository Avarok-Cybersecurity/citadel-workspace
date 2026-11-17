/**
 * An unclaimed workspace offers its owner the claim step after the prompt was
 * set aside. Live, after a reload, nothing led back to it. The banner is
 * rendered for real; the claim itself is the caller's (it reopens the
 * Initialize dialog), so onClaim is recorded, not mocked out of anything.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClaimLaterBanner } from '../ClaimLaterBanner';

describe('claiming a workspace later', () => {
  it('is offered while the workspace is unclaimed and the prompt is set aside', () => {
    const claims: number[] = [];
    render(<ClaimLaterBanner visible onClaim={(): void => { claims.push(1); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));
    expect(claims).toEqual([1]);
  });

  it('is not shown otherwise', () => {
    render(<ClaimLaterBanner visible={false} onClaim={(): void => undefined} />);
    expect(screen.queryByTestId('claim-later-banner')).toBeNull();
  });

  it('can itself be set aside', () => {
    render(<ClaimLaterBanner visible onClaim={(): void => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide this' }));
    expect(screen.queryByTestId('claim-later-banner')).toBeNull();
  });
});
