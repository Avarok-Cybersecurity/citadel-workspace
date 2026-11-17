import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MDXToolbar } from '../MDXToolbar';

/**
 * Every button here is icon-only, and its label lived in a TooltipContent that is
 * not rendered until hover — so a screen reader announced twelve buttons called
 * "button", with no way to tell them apart.
 *
 * The label and the aria-label come from the same source, so this also catches
 * the two drifting apart.
 */
afterEach(cleanup);

function renderToolbar(): { onBold: ReturnType<typeof vi.fn>; onItalic: ReturnType<typeof vi.fn>; onUnderline: ReturnType<typeof vi.fn>; onHeading: ReturnType<typeof vi.fn>; onList: ReturnType<typeof vi.fn>; onBlockquote: ReturnType<typeof vi.fn>; onCode: ReturnType<typeof vi.fn>; onLink: ReturnType<typeof vi.fn>; onImage: ReturnType<typeof vi.fn>; } {
  const handlers: { onBold: ReturnType<typeof vi.fn>; onItalic: ReturnType<typeof vi.fn>; onUnderline: ReturnType<typeof vi.fn>; onHeading: ReturnType<typeof vi.fn>; onList: ReturnType<typeof vi.fn>; onBlockquote: ReturnType<typeof vi.fn>; onCode: ReturnType<typeof vi.fn>; onLink: ReturnType<typeof vi.fn>; onImage: ReturnType<typeof vi.fn> } = {
    onBold: vi.fn(), onItalic: vi.fn(), onUnderline: vi.fn(),
    onHeading: vi.fn(), onList: vi.fn(), onBlockquote: vi.fn(),
    onCode: vi.fn(), onLink: vi.fn(), onImage: vi.fn(),
  };
  render(<MDXToolbar {...handlers} />);
  return handlers;
}

describe('MDXToolbar', () => {
  it('gives every button an accessible name', () => {
    renderToolbar();

    const unnamed: HTMLElement[] = screen
      .getAllByRole('button')
      .filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim());

    expect(unnamed).toEqual([]);
  });

  it('names them distinguishably, not just non-empty', () => {
    renderToolbar();

    const names: (string | null)[] = screen.getAllByRole('button').map((b): string | null => b.getAttribute('aria-label'));
    // Twelve buttons all called "Format" would satisfy the check above while
    // remaining just as unusable.
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Bold');
    expect(names).toContain('Italic');
  });

  it('invokes the formatting action it is named for', () => {
    const { onBold, onItalic } = renderToolbar();

    screen.getByRole('button', { name: 'Bold' }).click();
    screen.getByRole('button', { name: 'Italic' }).click();

    expect(onBold).toHaveBeenCalled();
    expect(onItalic).toHaveBeenCalled();
  });
});
