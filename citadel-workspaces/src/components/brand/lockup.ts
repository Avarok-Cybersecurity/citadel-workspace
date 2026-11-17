import type { BrandArtwork } from './artwork/brand-artwork';
import { MARK } from './artwork/mark.generated';
import { MARK_COMPACT } from './artwork/mark-compact.generated';
import { LOGO_HORIZONTAL } from './artwork/logo-horizontal.generated';
import { LOGO_STACKED } from './artwork/logo-stacked.generated';
import { WORDMARK } from './artwork/wordmark.generated';
import { MINIMUM_SIZE } from './artwork/brand-rules.generated';

/**
 * Which kit file a lockup at a given size is, and how large it may be drawn.
 *
 *   horizontal  mark + "Citadel Workspaces", the default     min 120 px wide
 *   stacked     mark over the name, square and splash         min  96 px wide
 *   wordmark    the mark as the name's C                      min  96 px wide
 *   mark        square contexts                               min  16 px; compact cut under 32
 *
 * The floors are the guidelines' (tokens/brand.json), so a size under one is a defect in the
 * caller, found when it renders rather than shipped as an illegible logo.
 */
export type CitadelLogoVariant = 'mark' | 'horizontal' | 'stacked' | 'wordmark';

export interface ResolvedLockup {
  readonly artwork: BrandArtwork;
  readonly width: number;
  readonly height: number;
  /** The clear space, in CSS pixels, on every side. */
  readonly clearSpace: number;
}

const LOCKUPS: Readonly<Record<Exclude<CitadelLogoVariant, 'mark'>, readonly [BrandArtwork, number]>> = {
  horizontal: [LOGO_HORIZONTAL, MINIMUM_SIZE.horizontalPx],
  stacked: [LOGO_STACKED, MINIMUM_SIZE.stackedPx],
  wordmark: [WORDMARK, MINIMUM_SIZE.wordmarkPx],
};

function sized(artwork: BrandArtwork, height: number): ResolvedLockup {
  const scale: number = height / artwork.height;
  return { artwork, height, width: artwork.width * scale, clearSpace: artwork.clearSpace * scale };
}

/** `height` is the rendered height in CSS pixels; the width follows the artwork. */
export function resolveLockup(variant: CitadelLogoVariant, height: number): ResolvedLockup {
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`Citadel ${variant}: height must be a positive number of pixels, got ${height}`);
  }
  if (variant === 'mark') {
    if (height < MINIMUM_SIZE.markPx) {
      throw new RangeError(`Citadel mark: ${height}px is under the ${MINIMUM_SIZE.markPx}px minimum`);
    }
    return sized(height < MINIMUM_SIZE.compactBelowPx ? MARK_COMPACT : MARK, height);
  }
  const [artwork, minimumWidth]: readonly [BrandArtwork, number] = LOCKUPS[variant];
  const lockup: ResolvedLockup = sized(artwork, height);
  if (lockup.width < minimumWidth) {
    throw new RangeError(
      `Citadel ${variant}: ${lockup.width.toFixed(1)}px wide is under the ${minimumWidth}px minimum`,
    );
  }
  return lockup;
}
