/**
 * Escape in the Terms of Use dialog closed it AND left the Join step behind it.
 * Radix answers Escape from a capture listener on the document; closing the
 * nested dialog re-enabled the Join overlay, React committed before the same
 * key event reached the bubble phase, and the overlay's freshly added listener
 * dismissed Join too. One key, two dialogs gone, and the form with them.
 *
 * Radix marks the Escape it answers with preventDefault(), so the contract is:
 * an Escape someone already handled dismisses nothing else. jsdom does not
 * reproduce the browser's ordering (the Radix cases below pass without the
 * fix); the first case is the one that fails without it, and the real-browser
 * check lives in the UX review script.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useDialogOverlay } from '../use-dialog-overlay';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

function Wizard({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const [nestedOpen, setNestedOpen] = useState<boolean>(true);
  const { ref, dialogProps } = useDialogOverlay<HTMLDivElement>({ label: 'Join', onDismiss, enabled: !nestedOpen });
  return (
    <div ref={ref} {...dialogProps}>
      <input aria-label="name" />
      {nestedOpen && (
        <Dialog open onOpenChange={(open: boolean): void => setNestedOpen(open)}>
          <DialogContent>
            <DialogTitle>Terms of Use</DialogTitle>
            <DialogDescription>Read and accept.</DialogDescription>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Overlay({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const { ref, dialogProps } = useDialogOverlay<HTMLDivElement>({ label: 'Join', onDismiss });
  return <div ref={ref} {...dialogProps}><input aria-label="name" /></div>;
}

describe('a nested dialog closed by Escape', () => {
  it('an Escape another layer already handled does not dismiss this one', () => {
    const onDismiss: Mock<() => void> = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);
    const handled: KeyboardEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(onDismiss).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes only itself; the overlay behind it stays', async () => {
    const onDismiss: Mock<() => void> = vi.fn();
    render(<Wizard onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: 'Terms of Use' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Terms of Use' })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('leaves the overlay answering the next Escape', async () => {
    const onDismiss: Mock<() => void> = vi.fn();
    render(<Wizard onDismiss={onDismiss} />);

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
