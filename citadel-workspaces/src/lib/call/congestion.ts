/**
 * Sender-side quality adaptation.
 *
 * The transport under a call is a lossy UDP channel, so congestion shows up as
 * loss and latency rather than backpressure — nothing upstream will ever tell
 * the encoder to slow down. If the sender does not react, it keeps pushing
 * 1.2 Mbps into a link that cannot carry it and the call degrades until it is
 * unusable, rather than gracefully getting smaller.
 *
 * The ladder here is deliberately coarse. Fine-grained rate control needs
 * measurements this transport does not expose, and a controller that reacts to
 * noise oscillates, which looks far worse than one that steps.
 */

export interface QualityReport {
  /** Fraction of frames the receiver never saw, 0..1. */
  lossRate: number;
  /** How far behind the receiver's playout is, milliseconds. */
  playoutDelayMs: number;
}

/**
 * What one report says about the link, before the ladder decides anything.
 *
 * Split from the ladder because there are two honest ways to reach this verdict
 * and only one ladder. The transport does not expose loss or playout delay
 * today, so the live path derives the verdict from the receiver's own gap-based
 * quality judgement — thresholds that were already tuned against this exact
 * signal for the participant tiles. Inventing a loss rate to feed the numeric
 * path instead would have been a number nothing measured.
 */
export type LinkVerdict = 'struggling' | 'holding' | 'clean';

/** The verdict from measured loss and delay, once a transport reports them. */
export function verdictFromMetrics(report: QualityReport): LinkVerdict {
  if (report.lossRate > LOSS_DEGRADE || report.playoutDelayMs > DELAY_DEGRADE_MS) {
    return 'struggling';
  }
  if (report.lossRate <= LOSS_RECOVER && report.playoutDelayMs <= DELAY_RECOVER_MS) {
    return 'clean';
  }
  return 'holding';
}

/**
 * The verdict from what the far side's receiver makes of our stream.
 *
 * 'lost' is deliberately NOT struggling. It means no frames at all for twelve
 * seconds, which is as likely to be a peer who muted and closed their camera as
 * a failing link — degrading our encoder on that evidence would punish the
 * common case.
 */
export function verdictFromLink(link: 'good' | 'fair' | 'poor' | 'lost'): LinkVerdict {
  if (link === 'poor') return 'struggling';
  if (link === 'good') return 'clean';
  return 'holding';
}

export interface QualityLevel {
  /** Multiplier applied to the profile's target bitrate. */
  bitrateScale: number;
  /** Frames per second to encode at. */
  framerate: number;
  /** Vertical resolution to scale to before encoding. */
  height: number;
  /** What the UI tells the user, when it is worth telling them. */
  label: 'good' | 'reduced' | 'poor';
}

/**
 * Rungs from best to worst. Video degrades; audio never appears here because it
 * is 32 kbps and must survive everything — a call with bad video is a call, a
 * call with bad audio is not.
 */
export const QUALITY_LADDER: readonly QualityLevel[] = [
  { bitrateScale: 1.0, framerate: 30, height: 720, label: 'good' },
  { bitrateScale: 0.66, framerate: 30, height: 540, label: 'reduced' },
  { bitrateScale: 0.42, framerate: 20, height: 540, label: 'reduced' },
  { bitrateScale: 0.25, framerate: 15, height: 360, label: 'poor' },
  { bitrateScale: 0.14, framerate: 10, height: 240, label: 'poor' },
];

/** Loss above this means the link cannot carry what we are sending. */
const LOSS_DEGRADE: number = 0.05;
/** Sustained delay above this means we are queuing, not just jittering. */
const DELAY_DEGRADE_MS: number = 250;
/** Only climb back when things are genuinely clean. */
const LOSS_RECOVER: number = 0.01;
const DELAY_RECOVER_MS: number = 120;

/**
 * Consecutive clean reports required before improving.
 *
 * Asymmetric on purpose: drop immediately, recover slowly. A link that just
 * failed will usually fail again, and oscillating between rungs is more
 * visually disruptive than sitting one rung lower than strictly necessary.
 */
export const RECOVERY_STREAK: number = 5;

export interface CongestionState {
  rung: number;
  cleanStreak: number;
}

export const INITIAL_CONGESTION: CongestionState = { rung: 0, cleanStreak: 0 };

export function applyReport(state: CongestionState, verdict: LinkVerdict): CongestionState {
  const struggling: boolean = verdict === 'struggling';
  const clean: boolean = verdict === 'clean';

  if (struggling) {
    return {
      rung: Math.min(state.rung + 1, QUALITY_LADDER.length - 1),
      cleanStreak: 0,
    };
  }

  if (!clean) {
    // In between: hold. Neither bad enough to drop nor good enough to climb,
    // and reacting to the middle is what makes controllers oscillate.
    return { ...state, cleanStreak: 0 };
  }

  const cleanStreak: number = state.cleanStreak + 1;
  if (cleanStreak >= RECOVERY_STREAK && state.rung > 0) {
    return { rung: state.rung - 1, cleanStreak: 0 };
  }
  return { ...state, cleanStreak };
}

export function levelFor(state: CongestionState): QualityLevel {
  return QUALITY_LADDER[Math.min(state.rung, QUALITY_LADDER.length - 1)];
}

/**
 * Whether a frame should be dropped before it is even encoded.
 *
 * The cheapest frame is the one never encoded. Under congestion, dropping
 * non-keyframes at the source keeps the stream decodable — dropping a keyframe
 * would corrupt everything after it until the next one.
 */
export function shouldDropFrame(
  state: CongestionState,
  isKeyframe: boolean,
  queuedFrames: number,
): boolean {
  if (isKeyframe) return false;
  if (state.rung === 0) return queuedFrames > 8;
  // The worse the link, the shorter the queue we tolerate: a long queue is
  // latency the user feels as delay in the conversation.
  return queuedFrames > Math.max(1, 8 - state.rung * 2);
}
