/**
 * The delivery tick on a sent message, and the details it opens.
 *
 * The details used to be a hover tooltip above the tick, then a popover beside it: both floated over
 * the very message they described (measured: at phone width the card hid the bubble's text), and the
 * tooltip held a Copy button inside something that vanishes when the pointer leaves. They open IN
 * the message now, under its footer, as a disclosure: a button you press (or tab to and open) that
 * pushes the content below it down instead of covering anything.
 *
 * Two parts because the panel is not a child of the row the tick sits in; the footer owns the state.
 */
import type { ReactNode } from 'react';

interface StatusTickProps {
  /** What the tick says, in words: the button's name, since the icon alone is a colour and a shape. */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** The id of the panel this button opens. */
  panelId: string;
  children: ReactNode;
}

export function StatusTick({ label, open, onToggle, panelId, children }: StatusTickProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`${label}. ${open ? 'Hide' : 'Show'} details`}
      aria-expanded={open}
      aria-controls={panelId}
      data-testid="message-status-details-trigger"
      onClick={onToggle}
      // The 24px floor without growing the footer row: the extra height is taken back in margin.
      className="tap-target -my-1.5 inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

export function StatusPanel({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return (
    <div
      id={id}
      data-testid="message-status-details"
      className="mt-2 max-w-full rounded-md border border-border bg-background p-3 text-left text-foreground shadow-sm"
    >
      {children}
    </div>
  );
}
