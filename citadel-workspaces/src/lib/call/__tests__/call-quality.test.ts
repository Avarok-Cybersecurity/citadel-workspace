/**
 * A quality indicator that is wrong is worse than none: it either cries wolf on
 * a healthy link, or stays green while someone's video breaks up and they are
 * left wondering whether it is their own connection.
 */
import { describe, it, expect } from 'vitest';
import type { ConnectionQuality } from '@/components/call/ParticipantTile';
import {
  CallQualityTracker,
  QUALITY_WINDOW_MS,
  FAIR_THRESHOLD,
  POOR_THRESHOLD,
  LOST_SILENCE_MS,
} from '../call-quality';

const BOB: bigint = 2n;
const CAROL: bigint = 3n;

function trackerWithGaps(count: number, at: number = 0): CallQualityTracker {
  const tracker: CallQualityTracker = new CallQualityTracker();
  tracker.recordFrame(BOB, at);
  for (let i: number = 0; i < count; i += 1) tracker.recordGap(BOB, at + i);
  return tracker;
}

describe('CallQualityTracker', () => {
  it('says nothing about a peer it has never heard from', () => {
    // Absent, not "good" — claiming a healthy connection with no evidence is
    // exactly the lie the old always-good default told.
    const tracker: CallQualityTracker = new CallQualityTracker();

    expect(tracker.snapshot(0).has(BOB)).toBe(false);
  });

  it('reports a peer delivering frames as good', () => {
    const tracker: CallQualityTracker = new CallQualityTracker();
    tracker.recordFrame(BOB, 0);

    expect(tracker.snapshot(100).get(BOB)).toBe('good');
  });

  it('tolerates a single gap without warning', () => {
    // One lost frame is a hiccup, not a failing link. Reacting to it would make
    // the indicator meaningless.
    expect(trackerWithGaps(1).snapshot(500).get(BOB)).toBe('good');
  });

  it('drops to fair once gaps accumulate', () => {
    expect(trackerWithGaps(FAIR_THRESHOLD).snapshot(500).get(BOB)).toBe('fair');
  });

  it('drops to poor when the picture is visibly breaking up', () => {
    expect(trackerWithGaps(POOR_THRESHOLD).snapshot(500).get(BOB)).toBe('poor');
  });

  it('recovers as gaps age out of the window', () => {
    const tracker: CallQualityTracker = trackerWithGaps(POOR_THRESHOLD);

    // The gaps were recorded across POOR_THRESHOLD successive ticks, so they do
    // not all age out at the same instant — the clock has to pass the window
    // measured from the LAST of them. Getting this wrong is how a recovery test
    // silently asserts a half-recovered state.
    const afterAllGapsExpired: number = QUALITY_WINDOW_MS + POOR_THRESHOLD + 1;
    tracker.recordFrame(BOB, afterAllGapsExpired);

    expect(tracker.snapshot(afterAllGapsExpired).get(BOB)).toBe('good');
  });

  it('reports silence as lost', () => {
    const tracker: CallQualityTracker = new CallQualityTracker();
    tracker.recordFrame(BOB, 0);

    expect(tracker.snapshot(LOST_SILENCE_MS).get(BOB)).toBe('lost');
  });

  it('does not call a muted, camera-off peer lost too quickly', () => {
    // Someone who turned everything off sends nothing and is still present, so
    // the silence threshold has to sit well beyond an ordinary gap.
    const tracker: CallQualityTracker = new CallQualityTracker();
    tracker.recordFrame(BOB, 0);

    expect(tracker.snapshot(LOST_SILENCE_MS - 1).get(BOB)).not.toBe('lost');
    expect(LOST_SILENCE_MS).toBeGreaterThan(QUALITY_WINDOW_MS);
  });

  it('tracks each participant separately', () => {
    // One bad link in a group call must not paint everyone else as degraded.
    const tracker: CallQualityTracker = new CallQualityTracker();
    tracker.recordFrame(BOB, 0);
    tracker.recordFrame(CAROL, 0);
    for (let i: number = 0; i < POOR_THRESHOLD; i += 1) tracker.recordGap(CAROL, i);

    const snapshot: Map<bigint, ConnectionQuality> = tracker.snapshot(500);
    expect(snapshot.get(BOB)).toBe('good');
    expect(snapshot.get(CAROL)).toBe('poor');
  });

  it('forgets a participant who left', () => {
    const tracker: CallQualityTracker = trackerWithGaps(POOR_THRESHOLD);
    tracker.forget(BOB);

    expect(tracker.snapshot(500).has(BOB)).toBe(false);
  });

  it('counts a gap from a peer never seen before', () => {
    // Gaps can arrive before the first decodable frame does.
    const tracker: CallQualityTracker = new CallQualityTracker();
    for (let i: number = 0; i < POOR_THRESHOLD; i += 1) tracker.recordGap(BOB, i);

    expect(tracker.snapshot(500).get(BOB)).toBe('poor');
  });
});
