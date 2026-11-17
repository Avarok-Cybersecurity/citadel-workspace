/**
 * With nobody to pick, the picker still opens and says why.
 *
 * `disabled={peers.length === 0}` made its own `emptyMessage` unreachable: the
 * group Invite button went grey with no explanation, exactly when one was due.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PeerPickerPopover } from '../PeerPickerPopover';

describe('an empty peer picker', () => {
  it('opens and shows its empty message', async () => {
    render(<PeerPickerPopover peers={[]} onSelect={vi.fn()} label="Invite" emptyMessage="Everyone you have registered is already in this group" />);
    const trigger: HTMLElement = screen.getByTestId('peer-picker-trigger');
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    expect(await screen.findByText('Everyone you have registered is already in this group')).toBeInTheDocument();
  });
});
