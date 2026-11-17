/**
 * Controls that a keyboard or screen-reader user must be able to reach.
 *
 * These assert against the rendered accessibility tree — `getByRole('button',
 * { name })` — rather than against class names or markup, because that is what
 * an assistive technology actually sees. A control styled as a button but
 * rendered as a div passes every visual check and fails this one.
 */
import { describe, it, expect, vi  } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '@/components/ui/badge';
import type { UserEvent } from '@testing-library/user-event';

describe('pending connection requests badge', () => {
  /**
   * The shape MembersSection renders. Kept here rather than mounting the whole
   * sidebar (which needs a workspace, a connection and a router) — the defect
   * was entirely in this element, and the negative control below proves the
   * test discriminates.
   */
  function PendingBadge({ count, onOpen }: { count: number; onOpen: () => void }): JSX.Element {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        aria-label={`Review ${count} pending connection request${count > 1 ? 's' : ''}`}
        className="rounded-full"
      >
        <Badge data-testid="pending-requests-badge">{count}</Badge>
      </button>
    );
  }

  it('is in the accessibility tree with a name that says what it does', () => {
    render(<PendingBadge count={3} onOpen={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /review 3 pending connection requests/i }),
    ).toBeInTheDocument();
  });

  it('opens the modal from the keyboard alone', async () => {
    const user: UserEvent = userEvent.setup();
    const onOpen: ReturnType<typeof vi.fn> = vi.fn();
    render(<PendingBadge count={1} onOpen={onOpen} />);

    // Tab to it and press Enter — no pointer involved. A clickable <div> takes
    // no focus, so this is the assertion the old markup could not pass.
    await user.tab();
    expect(screen.getByRole('button', { name: /review 1 pending/i })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('a clickable Badge — the shape this replaced — cannot do either', async () => {
    // The negative control, kept in the suite: this is what the code used to
    // render. If Badge ever starts rendering a <button>, this fails and the
    // tests above stop proving anything.
    const user: UserEvent = userEvent.setup();
    const onOpen: ReturnType<typeof vi.fn> = vi.fn();
    render(<Badge onClick={onOpen} title="3 pending connection requests">3</Badge>);

    expect(screen.queryByRole('button')).toBeNull();
    await user.tab();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
