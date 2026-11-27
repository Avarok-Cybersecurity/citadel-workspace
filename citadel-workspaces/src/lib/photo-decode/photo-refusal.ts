/**
 * Why a photo the page decodes itself is not shown, and the way on from each reason. Pure.
 *
 * The plans are RecoveryPlan-shaped (RECOVERY-DESIGN.md §2: cause, presentation, a required
 * primary route, alternatives) so they register as surfaces unchanged once lib/recovery-route
 * lands. A preview sits beside the file's own Download control, so a refusal there blocks nothing
 * (acknowledge, and the clause names Download); an avatar has to be a different photo (fix-input);
 * a decoder that failed to load or run is ours (retry, and the bug report the renderer derives).
 */

export type PhotoRefusal =
  | { readonly kind: 'too-large'; readonly width: number; readonly height: number }
  | { readonly kind: 'unsupported'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'decoder-failed'; readonly detail: string };

export type PhotoRefusalKind = PhotoRefusal['kind'];

export function isPhotoRefusal(value: unknown): value is PhotoRefusal {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  const kind: unknown = (value as { kind: unknown }).kind;
  return kind === 'too-large' || kind === 'unsupported' || kind === 'unreadable' || kind === 'decoder-failed';
}

type PhotoRoute =
  | { readonly kind: 'acknowledge'; readonly why: 'informational' }
  | { readonly kind: 'fix-input' }
  | { readonly kind: 'retry' };

interface PhotoPlan {
  readonly cause: 'user' | 'ours' | 'environment';
  readonly presentation: 'inline';
  readonly primary: PhotoRoute;
  readonly alternatives: readonly PhotoRoute[];
}

const SEE_IT: PhotoRoute = { kind: 'acknowledge', why: 'informational' };
const OTHER_PHOTO: PhotoRoute = { kind: 'fix-input' };
const RETRY: PhotoRoute = { kind: 'retry' };

export const PHOTO_PREVIEW_PLANS: Readonly<Record<PhotoRefusalKind, PhotoPlan>> = {
  'too-large': { cause: 'environment', presentation: 'inline', primary: SEE_IT, alternatives: [] },
  unsupported: { cause: 'environment', presentation: 'inline', primary: SEE_IT, alternatives: [] },
  unreadable: { cause: 'environment', presentation: 'inline', primary: SEE_IT, alternatives: [] },
  'decoder-failed': { cause: 'ours', presentation: 'inline', primary: RETRY, alternatives: [] },
};

export const AVATAR_PHOTO_PLANS: Readonly<Record<PhotoRefusalKind, PhotoPlan>> = {
  'too-large': { cause: 'user', presentation: 'inline', primary: OTHER_PHOTO, alternatives: [] },
  unsupported: { cause: 'user', presentation: 'inline', primary: OTHER_PHOTO, alternatives: [] },
  unreadable: { cause: 'user', presentation: 'inline', primary: OTHER_PHOTO, alternatives: [] },
  'decoder-failed': { cause: 'ours', presentation: 'inline', primary: RETRY, alternatives: [OTHER_PHOTO] },
};

const megapixels = (maxPixels: number): string => `${Math.floor(maxPixels / 1_000_000)} megapixels`;

/** A clause for a chat preview ("This picture cannot be shown: <clause>."), naming the way on. */
export function previewRefusalClause(refusal: PhotoRefusal): string {
  switch (refusal.kind) {
    case 'too-large': return `at ${refusal.width} x ${refusal.height} it is too large to preview here; Download opens it in your photo app`;
    case 'unsupported': return `the preview cannot read it (${refusal.detail}); Download opens it in your photo app`;
    case 'unreadable': return `it could not be read as a photo (${refusal.detail})`;
    case 'decoder-failed': return `the photo preview did not load (${refusal.detail}); open it again to retry`;
  }
}

/** A sentence for the avatar picker, naming the way on. */
export function avatarRefusalSentence(refusal: PhotoRefusal, maxPixels: number): string {
  switch (refusal.kind) {
    case 'too-large': return `This photo is ${refusal.width} x ${refusal.height}, too large to use. Choose one under ${megapixels(maxPixels)}.`;
    case 'unsupported': return `This photo uses something that cannot be read here (${refusal.detail}). Choose a JPEG or PNG instead.`;
    case 'unreadable': return `This file could not be read as a photo (${refusal.detail}). Choose another photo.`;
    case 'decoder-failed': return `The photo converter did not load (${refusal.detail}). Try again, or choose a JPEG or PNG.`;
  }
}
