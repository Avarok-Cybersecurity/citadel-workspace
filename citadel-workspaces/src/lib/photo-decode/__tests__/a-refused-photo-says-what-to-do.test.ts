/**
 * Every refusal reads as what happened and the way on: a preview names Download (the control
 * beside it), an avatar asks for another photo, and a decoder failure is retried. Each kind names
 * a registered RecoveryRoute surface on both the preview and the avatar picker.
 */
import { describe, it, expect } from 'vitest';
import { avatarRefusalSentence, previewRefusalClause, type PhotoRefusal, type PhotoRefusalKind } from '../photo-refusal';
import type { SurfaceId } from '@/lib/recovery-route/surfaces';
import { planOf } from '@/lib/recovery-route/plan-of';
import { alternativesOf } from '@/lib/recovery-route/derive';
import type { RecoveryPlan } from '@/lib/recovery-route/route';

// Compiles only while every refusal kind has both surfaces registered.
const preview = (kind: PhotoRefusalKind): SurfaceId => `photo.preview.${kind}` satisfies SurfaceId;
const avatar = (kind: PhotoRefusalKind): SurfaceId => `photo.avatar.${kind}` satisfies SurfaceId;

const ALL: PhotoRefusal[] = [
  { kind: 'too-large', width: 8064, height: 6048 },
  { kind: 'unsupported', detail: 'inter prediction' },
  { kind: 'unreadable', detail: 'truncated file' },
  { kind: 'decoder-failed', detail: 'it took longer than 60 s' },
];

describe('a refused photo', () => {
  it('in a chat names its size or reason and the way on', () => {
    expect(previewRefusalClause(ALL[0])).toBe('at 8064 x 6048 it is too large to preview here; Download saves it for your photo app');
    expect(previewRefusalClause(ALL[1])).toContain('Download');
    expect(previewRefusalClause(ALL[3])).toContain('try again');
  });
  it('as an avatar asks for a photo that will do', () => {
    expect(avatarRefusalSentence(ALL[0], 40_000_000)).toBe('This photo is 8064 x 6048, too large to use. Choose one under 40 megapixels.');
    for (const r of ALL) expect(avatarRefusalSentence(r, 40_000_000)).toMatch(/Choose|Try again/);
  });
  it('names a registered surface with a way on for every kind, on both surfaces', () => {
    for (const r of ALL) {
      expect(planOf(preview(r.kind)).primary.kind).toBeTruthy();
      expect(planOf(avatar(r.kind)).primary.kind).not.toBe('acknowledge');
    }
    const failed: RecoveryPlan = planOf(preview('decoder-failed'));
    expect(failed).toMatchObject({ cause: 'ours', primary: { kind: 'retry' } });
    expect(alternativesOf(failed).map((route) => route.kind)).toEqual(['report-bug']);
    expect(planOf(avatar('too-large')).primary).toEqual({ kind: 'fix-input' });
  });
});
