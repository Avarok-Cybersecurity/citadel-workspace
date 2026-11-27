/**
 * The UX score (score.ts) over plans written here: a one-step way out scores full marks, a longer one
 * less, a wait a little less than its fallback, a dead end nothing; a page weighs more than a toast,
 * and our own failure more than the environment's; a notice with nothing to recover is left out.
 */
import { describe, expect, it } from 'vitest';
import type { RecoveryPlan } from '../route';
import { uxScore, type Score } from '../score';

const retryPage: RecoveryPlan = { cause: 'environment', presentation: 'page', primary: { kind: 'retry' }, alternatives: [] };
const waitPage: RecoveryPlan = { cause: 'environment', presentation: 'page', primary: { kind: 'wait', until: 'network-online', deadlineMs: 1_000, then: { kind: 'retry' } }, alternatives: [] };
const note: RecoveryPlan = { cause: 'ours', presentation: 'toast', primary: { kind: 'acknowledge', why: 'informational' }, alternatives: [] };

describe('the UX score', () => {
  it('is full marks for one-step ways out, and nothing to recover is left out', () => {
    const s: Score = uxScore({ plans: [retryPage, note], deadEnds: 0 });
    expect(s).toEqual({ score: 100, surfaces: 1, deadEnds: 0 });
  });

  it('costs a wait a tenth of its fallback', () => {
    expect(uxScore({ plans: [waitPage], deadEnds: 0 }).score).toBe(90);
  });

  it('counts each dead end as a way out worth nothing, weighing one', () => {
    // A page weighs 4: 4 of 4 + 4 dead ends = 50.
    expect(uxScore({ plans: [retryPage], deadEnds: 4 }).score).toBe(50);
  });

  it('weighs our own failure half again', () => {
    const ours: RecoveryPlan = { ...retryPage, cause: 'ours' };
    // 6 of 6 + 2 dead ends = 75, where the environment's would be 4 of 6 = 66.7.
    expect(uxScore({ plans: [ours], deadEnds: 2 }).score).toBe(75);
    expect(uxScore({ plans: [retryPage], deadEnds: 2 }).score).toBe(66.7);
  });
});
