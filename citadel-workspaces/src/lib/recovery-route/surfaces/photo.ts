/**
 * Ways out of a photo the page could not draw (lib/photo-decode). In the picture viewer the
 * refusal sits above the file's own Download, which stays enabled, so nothing is blocked: the
 * sentence names Download and OK closes the viewer. An avatar has to be a different photo. A
 * decoder that did not load or run is ours: try again, and the bug report derive.ts adds.
 */
import type { DeclaredPlan } from '../route';

export const PHOTO_SURFACES = {
  'photo.preview.too-large': { cause: 'environment', presentation: 'inline', primary: { kind: 'acknowledge', why: 'informational' }, alternatives: [] },
  'photo.preview.unsupported': { cause: 'environment', presentation: 'inline', primary: { kind: 'acknowledge', why: 'informational' }, alternatives: [] },
  'photo.preview.unreadable': { cause: 'environment', presentation: 'inline', primary: { kind: 'acknowledge', why: 'informational' }, alternatives: [] },
  'photo.preview.decoder-failed': { cause: 'ours', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [] },
  'photo.avatar.too-large': { cause: 'user', presentation: 'inline', primary: { kind: 'fix-input' }, alternatives: [] },
  'photo.avatar.unsupported': { cause: 'user', presentation: 'inline', primary: { kind: 'fix-input' }, alternatives: [] },
  'photo.avatar.unreadable': { cause: 'user', presentation: 'inline', primary: { kind: 'fix-input' }, alternatives: [] },
  'photo.avatar.decoder-failed': { cause: 'ours', presentation: 'inline', primary: { kind: 'retry' }, alternatives: [{ kind: 'fix-input' }] },
} as const satisfies Record<string, DeclaredPlan>;
