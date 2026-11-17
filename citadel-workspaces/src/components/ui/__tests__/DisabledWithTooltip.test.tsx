import { describe, it, expect, vi, afterEach  } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DisabledWithTooltip } from '../DisabledWithTooltip';

/**
 * These wrappers grey a control out and set `pointer-events: none`. CSS does not
 * stop the keyboard, so before the fix the button inside stayed focusable and
 * Enter still fired its onClick — a permission-gated action was fully operable
 * by anyone not using a mouse, and reported isEnabled() as true.
 *
 * Guarded here rather than in an integration spec because the defect is a single
 * attribute on a single element, and a unit test can say so in milliseconds.
 */
afterEach(cleanup);

// Only one wrapper now: DisabledWithError was the unused twin and was removed
// with the rest of the dead UI. It carried this same defect, so deleting it
// removed a trap as well as dead weight.
describe('DisabledWithTooltip', () => {
  const Wrapper: typeof DisabledWithTooltip = DisabledWithTooltip;

  it('passes children through untouched when not disabled', () => {
    render(
      <Wrapper disabled={false} tooltip="nope">
        <button type="button">Delete office</button>
      </Wrapper>
    );

    expect(screen.getByRole('button', { name: 'Delete office' })).toBeEnabled();
  });

  it('really disables the control, not just its appearance', () => {
    render(
      <Wrapper disabled tooltip="You need EditTreeStructure for this">
        <button type="button">Delete office</button>
      </Wrapper>
    );

    const button: HTMLElement = screen.getByRole('button', { name: 'Delete office' });
    expect(button).toBeDisabled();
    // Also out of the tab order: a control that cannot be activated should not
    // collect focus on the way past it.
    expect(button).toHaveAttribute('tabindex', '-1');
  });

  it('does not fire onClick while disabled', () => {
    const onClick: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <Wrapper disabled tooltip="blocked">
        <button type="button" onClick={onClick}>Delete office</button>
      </Wrapper>
    );

    // click() on a disabled button is a no-op in the DOM, which is the point:
    // before the fix this element was not disabled and the handler ran.
    screen.getByRole('button', { name: 'Delete office' }).click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
