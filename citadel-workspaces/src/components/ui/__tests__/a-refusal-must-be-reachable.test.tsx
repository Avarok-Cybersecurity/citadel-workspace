/**
 * Why a permission-gated control is refused has to be in the document.
 *
 * The reason lived only inside the Radix tooltip, which renders in a portal
 * while the pointer is over the trigger — so it existed for a mouse and for
 * nothing else. The region announced itself as disabled and never said why, and
 * a failing test's DOM dump showed a bare `<button disabled>Edit</button>` with
 * no clue: the workspace admin waiting sixty seconds for their own Edit button,
 * with the answer in an element that never rendered.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisabledWithTooltip } from '../DisabledWithTooltip';

const REASON: string = 'Permissions have not been loaded for this domain';

describe('a refused control explains itself', () => {
  it('carries the reason in the DOM, not only in a hover tooltip', () => {
    render(
      <DisabledWithTooltip disabled tooltip={REASON}>
        <button type="button">Edit</button>
      </DisabledWithTooltip>,
    );

    const region: HTMLElement = screen.getByRole('group');
    expect(region).toHaveAttribute('title', REASON);
    expect(region).toHaveAccessibleName(REASON);
  });

  it('names the reason on the control itself, not only on the wrapper', () => {
    render(
      <DisabledWithTooltip disabled tooltip={REASON}>
        <button type="button">Edit</button>
      </DisabledWithTooltip>,
    );

    const button: HTMLElement = screen.getByRole('button', { name: 'Edit' });
    expect(button).toHaveAttribute('title', REASON);
    // Still genuinely disabled: a readable explanation, not a reachable action.
    expect(button).toBeDisabled();
  });

  it('adds nothing when the control is not refused', () => {
    render(
      <DisabledWithTooltip disabled={false} tooltip={REASON}>
        <button type="button">Edit</button>
      </DisabledWithTooltip>,
    );

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });
});
