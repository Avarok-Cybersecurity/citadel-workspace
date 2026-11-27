/**
 * Why a photo the page decodes itself is not shown, and the words for each reason. Pure.
 *
 * The way on from each reason is a RecoveryRoute surface (recovery-route/surfaces/photo.ts),
 * `photo.preview.<kind>` in the picture viewer and `photo.avatar.<kind>` in the avatar picker,
 * named by literal where each is drawn (the dead-end scan counts only literals).
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

const megapixels = (maxPixels: number): string => `${Math.floor(maxPixels / 1_000_000)} megapixels`;

/** A clause for a chat preview ("This picture cannot be shown: <clause>."), naming the way on. */
export function previewRefusalClause(refusal: PhotoRefusal): string {
  switch (refusal.kind) {
    case 'too-large': return `at ${refusal.width} x ${refusal.height} it is too large to preview here; Download saves it for your photo app`;
    case 'unsupported': return `the preview cannot read it (${refusal.detail}); Download saves it for your photo app`;
    case 'unreadable': return `it could not be read as a photo (${refusal.detail})`;
    case 'decoder-failed': return `the photo preview did not load (${refusal.detail}); try again`;
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
