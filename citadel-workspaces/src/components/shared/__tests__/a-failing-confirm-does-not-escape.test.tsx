/**
 * A confirm action that fails must not leave an unhandled rejection.
 *
 * The dialog cleared its pending flag with `void result.finally(...)`.
 * `finally` RE-THROWS, so that discarded a rejected promise — an unhandled
 * rejection from the one dialog every destructive action in the app shares,
 * for any action that fails. Reporting belongs to the caller; the dialog owns
 * only its pending state, and it must clear that either way.
 *
 * Vitest fails a test that leaves an unhandled rejection, so the absence of one
 * is what this asserts — with the button coming back as the visible proof that
 * the pending flag cleared on the failing path too.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';

describe('a confirm action that rejects', () => {
  it('clears pending and does not escape as an unhandled rejection', async (): Promise<void> => {
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn(
      async (): Promise<void> => { throw new Error('the caller reports this'); },
    );

    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={(): void => {}}
        onConfirm={onConfirm}
        title="Delete it?"
        confirmLabel="Delete"
      />,
    );

    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalled();

    // Pending cleared: the control is usable again rather than stuck.
    await waitFor((): void => {
      expect(screen.getByTestId('confirm-dialog-confirm')).not.toBeDisabled();
    });
  });

  it('still clears pending when the action succeeds', async (): Promise<void> => {
    // Positive control: a handler that only ever cleared on failure would pass
    // the test above.
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {});

    render(
      <ConfirmDeleteDialog
        open
        onOpenChange={(): void => {}}
        onConfirm={onConfirm}
        title="Delete it?"
        confirmLabel="Delete"
      />,
    );

    await userEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor((): void => {
      expect(screen.getByTestId('confirm-dialog-confirm')).not.toBeDisabled();
    });
  });
});
