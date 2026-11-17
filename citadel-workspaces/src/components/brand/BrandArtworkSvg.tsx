import type { ResolvedLockup } from './lockup';

export interface BrandArtworkSvgProps {
  readonly lockup: ResolvedLockup;
  /** The accessible name, or `null` when something beside it already names the product. */
  readonly label: string | null;
}

/**
 * Draws a kit lockup inline. The paths are the kit's (outlined, so no font is involved); the
 * colours are the brand variables, which take the light or -ondark values from the ground the
 * theme paints (styles/brand-tokens.css). Inline rather than an <img> so the cut flips in the
 * same paint as the theme, with no second file to fetch and no flash of the wrong one.
 *
 * Colour sits in SVG attributes, not Tailwind classes: a `stroke-*` utility would have to be a
 * theme token, and the logo must never take a workspace's palette.
 */
export function BrandArtworkSvg({ lockup, label }: BrandArtworkSvgProps): JSX.Element {
  const { artwork } = lockup;
  const decorative: boolean = label === null;
  return (
    <svg
      viewBox={artwork.viewBox}
      width={lockup.width}
      height={lockup.height}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={label ?? undefined}
      focusable="false"
    >
      <g fill="none" strokeWidth={artwork.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d={artwork.arc} stroke="var(--citadel-ink)" />
        <path d={artwork.arrow} stroke="var(--citadel-arrow)" />
      </g>
      {artwork.glyphs !== null && <path d={artwork.glyphs} fill="var(--citadel-ink)" />}
    </svg>
  );
}
