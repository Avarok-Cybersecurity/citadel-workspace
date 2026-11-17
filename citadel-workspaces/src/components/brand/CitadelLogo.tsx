import { BrandArtworkSvg } from './BrandArtworkSvg';
import { BRAND_NAME } from './artwork/brand-rules.generated';
import { resolveLockup, type CitadelLogoVariant, type ResolvedLockup } from './lockup';

export type { CitadelLogoVariant } from './lockup';

export interface CitadelLogoProps {
  readonly variant: CitadelLogoVariant;
  /** Rendered height of the artwork in CSS pixels; the width follows it. */
  readonly height: number;
  readonly className?: string;
}

/**
 * A Citadel Workspaces lockup with its clear space: one x (the arrowhead's height) of padding on
 * every side, so nothing placed beside it can enter that space.
 *
 * Always named: the name in a lockup is outlined paths, not text, so without a label a screen
 * reader would find nothing there at all.
 */
export function CitadelLogo({ variant, height, className }: CitadelLogoProps): JSX.Element {
  const lockup: ResolvedLockup = resolveLockup(variant, height);
  return (
    <span
      className={`inline-flex ${className ?? ''}`.trim()}
      style={{ padding: `${lockup.clearSpace}px` }}
      data-citadel-logo={variant}
    >
      <BrandArtworkSvg lockup={lockup} label={BRAND_NAME} />
    </span>
  );
}
