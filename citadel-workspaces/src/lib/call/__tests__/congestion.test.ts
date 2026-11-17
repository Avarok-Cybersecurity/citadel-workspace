/**
 * Nothing upstream tells the encoder to slow down on a lossy channel, so if this
 * logic is wrong the call does not fail loudly — it just gets steadily worse
 * while the sender keeps pushing a bitrate the link cannot carry.
 */
import { describe, it, expect } from 'vitest';
import type { LinkVerdict } from '@/lib/call/congestion';
import {
  applyReport,
  verdictFromMetrics,
  verdictFromLink,
  levelFor,
  shouldDropFrame,
  INITIAL_CONGESTION,
  QUALITY_LADDER,
  RECOVERY_STREAK,
  type CongestionState,
} from '../congestion';

// Still expressed as measurements, then turned into the verdict the ladder
// consumes — so these keep testing the thresholds, not just the ladder.
const CLEAN: LinkVerdict = verdictFromMetrics({ lossRate: 0, playoutDelayMs: 40 });
const LOSSY: LinkVerdict = verdictFromMetrics({ lossRate: 0.12, playoutDelayMs: 60 });
const DELAYED: LinkVerdict = verdictFromMetrics({ lossRate: 0, playoutDelayMs: 400 });
const MIDDLING: LinkVerdict = verdictFromMetrics({ lossRate: 0.03, playoutDelayMs: 180 });

function afterReports(state: CongestionState, report: typeof CLEAN, times: number): CongestionState {
  let next: CongestionState = state;
  for (let i: number = 0; i < times; i += 1) next = applyReport(next, report);
  return next;
}

describe('degrading', () => {
  it('drops a rung on loss', () => {
    expect(applyReport(INITIAL_CONGESTION, LOSSY).rung).toBe(1);
  });

  it('drops a rung on sustained delay even with no loss', () => {
    // Growing delay with zero loss is the signature of queueing, and it is the
    // failure mode that makes a call feel like a satellite link.
    expect(applyReport(INITIAL_CONGESTION, DELAYED).rung).toBe(1);
  });

  it('keeps dropping while conditions stay bad', () => {
    let state: CongestionState = INITIAL_CONGESTION;
    for (let i: number = 0; i < 3; i += 1) state = applyReport(state, LOSSY);
    expect(state.rung).toBe(3);
  });

  it('never falls off the bottom of the ladder', () => {
    let state: CongestionState = INITIAL_CONGESTION;
    for (let i: number = 0; i < 50; i += 1) state = applyReport(state, LOSSY);

    expect(state.rung).toBe(QUALITY_LADDER.length - 1);
    expect(levelFor(state)).toBeDefined();
  });
});

describe('recovering', () => {
  it('does not climb back on the first clean report', () => {
    // A link that just failed usually fails again; climbing immediately is how
    // a controller ends up oscillating.
    const degraded: CongestionState = applyReport(INITIAL_CONGESTION, LOSSY);
    expect(applyReport(degraded, CLEAN).rung).toBe(1);
  });

  it('climbs one rung after a sustained clean streak', () => {
    const degraded: CongestionState = applyReport(INITIAL_CONGESTION, LOSSY);
    const recovered: CongestionState = afterReports(degraded, CLEAN, RECOVERY_STREAK);

    expect(recovered.rung).toBe(0);
  });

  it('recovers one rung at a time, not all at once', () => {
    let state: CongestionState = INITIAL_CONGESTION;
    for (let i: number = 0; i < 3; i += 1) state = applyReport(state, LOSSY);
    expect(state.rung).toBe(3);

    state = afterReports(state, CLEAN, RECOVERY_STREAK);
    expect(state.rung).toBe(2);
  });

  it('resets the streak when conditions wobble', () => {
    const degraded: CongestionState = applyReport(INITIAL_CONGESTION, LOSSY);
    let state: CongestionState = afterReports(degraded, CLEAN, RECOVERY_STREAK - 1);
    state = applyReport(state, MIDDLING);
    state = applyReport(state, CLEAN);

    // One middling report must undo the progress, or we climb on a link that
    // never actually recovered.
    expect(state.rung).toBe(1);
  });

  it('holds at good without climbing past the top', () => {
    const state: CongestionState = afterReports(INITIAL_CONGESTION, CLEAN, RECOVERY_STREAK * 3);
    expect(state.rung).toBe(0);
  });
});

describe('the ladder itself', () => {
  it('gets monotonically cheaper on every axis', () => {
    for (let i: number = 1; i < QUALITY_LADDER.length; i += 1) {
      expect(QUALITY_LADDER[i].bitrateScale).toBeLessThan(QUALITY_LADDER[i - 1].bitrateScale);
      expect(QUALITY_LADDER[i].framerate).toBeLessThanOrEqual(QUALITY_LADDER[i - 1].framerate);
      expect(QUALITY_LADDER[i].height).toBeLessThanOrEqual(QUALITY_LADDER[i - 1].height);
    }
  });

  it('reports worsening labels as it descends', () => {
    expect(QUALITY_LADDER[0].label).toBe('good');
    expect(QUALITY_LADDER[QUALITY_LADDER.length - 1].label).toBe('poor');
  });
});

describe('dropping frames at the source', () => {
  it('never drops a keyframe', () => {
    // Dropping one corrupts every frame after it until the next keyframe —
    // strictly worse than sending it late.
    const worst: { rung: number; cleanStreak: number; } = { rung: QUALITY_LADDER.length - 1, cleanStreak: 0 };
    expect(shouldDropFrame(worst, true, 100)).toBe(false);
  });

  it('keeps a healthy sender sending', () => {
    expect(shouldDropFrame(INITIAL_CONGESTION, false, 2)).toBe(false);
  });

  it('drops delta frames once the queue builds', () => {
    expect(shouldDropFrame(INITIAL_CONGESTION, false, 20)).toBe(true);
  });

  it('tolerates less queueing the worse the link gets', () => {
    // Queue depth is latency the user hears as delay, so a struggling link
    // should hold less of it, not more.
    const mild: { rung: number; cleanStreak: number; } = { rung: 1, cleanStreak: 0 };
    const severe: { rung: number; cleanStreak: number; } = { rung: 3, cleanStreak: 0 };

    expect(shouldDropFrame(mild, false, 7)).toBe(true);
    expect(shouldDropFrame(severe, false, 3)).toBe(true);
    expect(shouldDropFrame(mild, false, 3)).toBe(false);
  });
});

describe('the verdict the live path actually uses', () => {
  // The transport exposes neither loss nor playout delay, so the running system
  // reaches its verdict from the receiver's gap-based judgement instead. These
  // pin that mapping, because it is what decides whether calls adapt at all.
  it('treats a poor link as cause to degrade', () => {
    expect(verdictFromLink('poor')).toBe('struggling');
    expect(applyReport(INITIAL_CONGESTION, verdictFromLink('poor')).rung).toBe(1);
  });

  it('treats a good link as cause to recover', () => {
    expect(verdictFromLink('good')).toBe('clean');
  });

  it('holds on a fair link rather than reacting to the middle', () => {
    expect(verdictFromLink('fair')).toBe('holding');
    const degraded: CongestionState = applyReport(INITIAL_CONGESTION, verdictFromLink('poor'));
    expect(applyReport(degraded, verdictFromLink('fair')).rung).toBe(1);
  });

  it('does not degrade on silence', () => {
    // 'lost' is twelve seconds without a frame, which is as likely to be a peer
    // who muted and closed their camera as a failing link. Degrading our
    // encoder on that evidence would punish the common case.
    expect(verdictFromLink('lost')).toBe('holding');
    expect(applyReport(INITIAL_CONGESTION, verdictFromLink('lost')).rung).toBe(0);
  });
});
