/**
 * "Clear Saved Accounts" promises only what it does.
 *
 * Measured live: the confirmation said "This signs you out and clears the stored
 * credentials". It signs nobody out -- every live session stayed active, the current
 * one included -- and no credentials have been stored since plaintext "remember me"
 * was retired (scrub-legacy-credentials). It empties the saved-account list.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClearAllConfirmDialog } from '../AccountConfirmDialogs';

describe('the clear-all confirmation', () => {
  it('says the list is cleared and live sessions stay signed in', () => {
    render(<ClearAllConfirmDialog open onOpenChange={(): void => {}} onConfirm={(): void => {}} />);
    const text: string = screen.getByRole('alertdialog').textContent ?? '';
    expect(text).not.toMatch(/signs you out|stored credentials/i);
    expect(text).toMatch(/stay signed in/i);
  });
});
