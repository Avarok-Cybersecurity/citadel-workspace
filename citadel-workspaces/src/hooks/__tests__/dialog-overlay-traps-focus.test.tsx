/**
 * The pre-auth overlays were `fixed inset-0` divs with a scrim: visually modal,
 * and to assistive technology nothing at all. No role, so a screen reader was
 * never told one opened; no trap, so Tab walked the landing-page controls buried
 * under the opaque scrim; no restore, so closing dropped focus to <body>.
 *
 * These drive the real hook through real Tab presses. Asserting that the markup
 * contains role="dialog" would pass on an overlay that still leaks focus, which
 * is the half that actually strands people.
 */
import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useDialogOverlay } from '../use-dialog-overlay';
import type { UserEvent } from '@testing-library/user-event';

function Overlay({ onDismiss }: { onDismiss?: () => void }): JSX.Element {
  const { ref, dialogProps } = useDialogOverlay<HTMLDivElement>({ label: 'Sign in', onDismiss });
  return (
    <div ref={ref} {...dialogProps}>
      <input aria-label="username" />
      <input aria-label="password" />
      <button>Submit</button>
    </div>
  );
}

/** A control outside the dialog, standing in for what the scrim covers. */
function Harness({ open, onDismiss }: { open: boolean; onDismiss?: () => void }): JSX.Element {
  return (
    <>
      <button>behind the scrim</button>
      {open && <Overlay onDismiss={onDismiss} />}
    </>
  );
}

describe('useDialogOverlay', () => {
  it('announces itself as a modal dialog with a name', () => {
    render(<Harness open />);
    const dialog: HTMLElement = screen.getByRole('dialog', { name: 'Sign in' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into the dialog rather than leaving it on the launcher', () => {
    render(<Harness open />);
    expect(screen.getByLabelText('username')).toHaveFocus();
  });

  it('keeps Tab inside, so focus never reaches controls under the scrim', async () => {
    const user: UserEvent = userEvent.setup();
    render(<Harness open />);

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus();

    // Past the last control it wraps, instead of walking out to the page.
    await user.tab();
    expect(screen.getByLabelText('username')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'behind the scrim' })).not.toHaveFocus();
  });

  it('wraps backwards too', async () => {
    const user: UserEvent = userEvent.setup();
    render(<Harness open />);

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus();
  });

  it('dismisses on Escape when the caller allows it', async () => {
    const user: UserEvent = userEvent.setup();
    const onDismiss: ReturnType<typeof vi.fn> = vi.fn();
    render(<Harness open onDismiss={onDismiss} />);

    await user.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('ignores Escape when the caller gives no dismiss — a modal that must not close', async () => {
    const user: UserEvent = userEvent.setup();
    render(<Harness open />);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('returns focus to whatever opened it', async () => {
    const user: UserEvent = userEvent.setup();
    function Toggle(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <Overlay onDismiss={() => setOpen(false)} />}
        </>
      );
    }
    render(<Toggle />);

    const opener: HTMLElement = screen.getByRole('button', { name: 'open' });
    await user.click(opener);
    expect(screen.getByLabelText('username')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(opener).toHaveFocus();
  });
});
