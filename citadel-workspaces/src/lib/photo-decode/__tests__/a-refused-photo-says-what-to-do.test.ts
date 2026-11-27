/**
 * Every refusal reads as what happened and the way on: a preview names Download (the control
 * beside it), an avatar asks for another photo, and a decoder failure is retried. Each kind has a
 * plan of the RecoveryPlan shape, with a primary route, on both surfaces.
 */
import { describe, it, expect } from 'vitest';
import { AVATAR_PHOTO_PLANS, PHOTO_PREVIEW_PLANS, avatarRefusalSentence, previewRefusalClause, type PhotoRefusal } from '../photo-refusal';

const ALL: PhotoRefusal[] = [
  { kind: 'too-large', width: 8064, height: 6048 },
  { kind: 'unsupported', detail: 'inter prediction' },
  { kind: 'unreadable', detail: 'truncated file' },
  { kind: 'decoder-failed', detail: 'it took longer than 60 s' },
];

describe('a refused photo', () => {
  it('in a chat names its size or reason and the way on', () => {
    expect(previewRefusalClause(ALL[0])).toBe('at 8064 x 6048 it is too large to preview here; Download opens it in your photo app');
    expect(previewRefusalClause(ALL[1])).toContain('Download');
    expect(previewRefusalClause(ALL[3])).toContain('retry');
  });
  it('as an avatar asks for a photo that will do', () => {
    expect(avatarRefusalSentence(ALL[0], 40_000_000)).toBe('This photo is 8064 x 6048, too large to use. Choose one under 40 megapixels.');
    for (const r of ALL) expect(avatarRefusalSentence(r, 40_000_000)).toMatch(/Choose|Try again/);
  });
  it('has a plan with a way on for every kind, on both surfaces', () => {
    for (const r of ALL) {
      expect(PHOTO_PREVIEW_PLANS[r.kind].primary.kind).toBeTruthy();
      expect(AVATAR_PHOTO_PLANS[r.kind].primary.kind).not.toBe('acknowledge');
    }
    expect(PHOTO_PREVIEW_PLANS['decoder-failed']).toMatchObject({ cause: 'ours', primary: { kind: 'retry' } });
  });
});
