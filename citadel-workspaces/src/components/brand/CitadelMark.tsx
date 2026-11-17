import { BrandArtworkSvg } from './BrandArtworkSvg';
import { resolveLockup, type ResolvedLockup } from './lockup';

export interface CitadelMarkProps {
  /**
   * Rendered height in CSS pixels. Under 32 the compact cut (stroke 22) is used, and under 16 it
   * refuses: both are the guidelines' legibility limits, not the caller's to remember.
   */
  readonly size: number;
  /**
   * A label for assistive technology, or `null` when the mark is decorative. Not optional: an
   * unlabelled role="img" fails Lighthouse's accessibility audit, so decorative is a decision.
   */
  readonly label: string | null;
}

/** The Citadel Workspaces mark alone: a C whose top becomes an arrow pointing right. */
export function CitadelMark({ size, label }: CitadelMarkProps): JSX.Element {
  const lockup: ResolvedLockup = resolveLockup('mark', size);
  return <BrandArtworkSvg lockup={lockup} label={label} />;
}
