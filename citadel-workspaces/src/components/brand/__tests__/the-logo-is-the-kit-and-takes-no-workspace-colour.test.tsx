/**
 * The logo is the kit's drawing, coloured for its ground, and never by a workspace's palette.
 *
 * A workspace administrator can repaint every theme token at runtime. The guidelines forbid the
 * logo following ("Recolour ... the arrow to a theme colour"), so the mark reads only the
 * --citadel-* variables. This asserts that mechanism rather than a rendered colour, which in
 * jsdom would only prove today's default theme agrees.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CitadelMark } from '../CitadelMark';
import { CitadelLogo } from '../CitadelLogo';
import { LOGO_HORIZONTAL } from '../artwork/logo-horizontal.generated';
import { BRAND_NAME } from '../artwork/brand-rules.generated';

describe('the Citadel Workspaces logo', () => {
  it('draws the C and the name in ink and only the arrow in purple, from brand variables', () => {
    const { container } = render(<CitadelLogo variant="horizontal" height={24} />);
    const paints: string[] = Array.from(container.querySelectorAll('path')).map(
      (p: Element): string => p.getAttribute('stroke') ?? `fill:${p.getAttribute('fill') ?? ''}`,
    );

    expect(paints).toEqual(['var(--citadel-ink)', 'var(--citadel-arrow)', 'fill:var(--citadel-ink)']);
    // The discriminating half: a theme token anywhere in the logo is the defect.
    expect(container.innerHTML).not.toMatch(/--primary|--accent|--foreground/);
  });

  it('carries the kit outlines, not live text in some font', () => {
    const { container } = render(<CitadelLogo variant="horizontal" height={24} />);
    const glyphs: string | null | undefined = container.querySelectorAll('path')[2]?.getAttribute('d');

    expect(glyphs).toBe(LOGO_HORIZONTAL.glyphs);
    expect(container.querySelector('text')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('is named, because its name is paths a screen reader cannot read', () => {
    const { getByRole } = render(<CitadelLogo variant="wordmark" height={16} />);

    expect(getByRole('img').getAttribute('aria-label')).toBe(BRAND_NAME);
    expect(BRAND_NAME).toBe('Citadel Workspaces');
  });

  it('keeps one arrowhead of clear space on every side', () => {
    const { container } = render(<CitadelLogo variant="horizontal" height={30} />);
    const wrapper: HTMLElement | null = container.querySelector('[data-citadel-logo]');
    const expected: number = (LOGO_HORIZONTAL.clearSpace / LOGO_HORIZONTAL.height) * 30;

    expect(wrapper?.style.padding).toBe(`${expected}px`);
    expect(expected).toBeGreaterThan(9);
  });

  it('hides a decorative mark from assistive technology', () => {
    const { container } = render(<CitadelMark size={56} label={null} />);
    const svg: Element | null = container.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });
});
