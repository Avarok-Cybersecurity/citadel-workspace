/**
 * A disabled control kept its reason in `title`, which a phone never shows. Wrapped in
 * `BlockedReason`, pressing it (tap, click, Enter, Space) says why.
 *
 * Real: the wrapper, the toast hook and Sonner's toaster. Nothing is mocked.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components/ui/sonner';
import { AddNodeButton } from '@/components/layout/sidebar/AddNodeButton';

const REASON: string = 'You do not have permission to add offices or rooms here.';

function mount(blockedReason: string | null): { pressed: () => number } {
  let presses: number = 0;
  render(<><Toaster /><AddNodeButton onClick={(): void => { presses += 1; }} blockedReason={blockedReason} label="Add to this workspace" testId="add" /></>);
  return { pressed: (): number => presses };
}

describe('a control that cannot be used says why', () => {
  it('on a tap, without running the action', async () => {
    const { pressed } = mount(REASON);
    await userEvent.click(screen.getByRole('button', { name: /Add to this workspace/ }));
    expect(await screen.findByText(REASON)).toBeTruthy();
    expect(pressed()).toBe(0);
  });

  it('from the keyboard, where a disabled button cannot even be reached', async () => {
    mount(REASON);
    await userEvent.tab();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('blocked-reason');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(REASON)).toBeTruthy();
  });

  it('and is one plain button when nothing blocks it', async () => {
    const { pressed } = mount(null);
    await userEvent.click(screen.getByTestId('add'));
    expect(pressed()).toBe(1);
    expect(screen.queryByTestId('blocked-reason')).toBeNull();
  });
});
