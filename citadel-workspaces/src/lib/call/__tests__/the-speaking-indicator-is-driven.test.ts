/**
 * The speaking indicator had a UI, a state field and a reducer case, and
 * nothing that dispatched.
 *
 * `call-state` declares `speaking`, `call-reducer` handles `speaking-changed`,
 * and `ParticipantTile` draws a ring plus an `sr-only` "speaking" label from it
 * — but no code ever produced the event, and `CallStage` passed a literal
 * `speaking: false`. Every part existed except the one that made it move.
 *
 * So this file tests BOTH halves. The pure decision is worth testing on its own
 * (hysteresis and hold are easy to get wrong and invisible in review), but a
 * detector nothing calls is exactly the defect being fixed, so the second half
 * drives a real CallSession and asserts the callback fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSpeakingDetector,
  rmsOf,
  SPEAKING_ON_RMS,
  SPEAKING_OFF_RMS,
  SPEAKING_HOLD_MS,
  type SpeakingDetector,
} from '../speaking-detector';

const LOUD: number = SPEAKING_ON_RMS + 0.01;
const QUIET: number = SPEAKING_OFF_RMS - 0.005;

describe('deciding when someone is speaking', () => {
  it('reports the change once, not on every subsequent block', (): void => {
    const detector: SpeakingDetector = createSpeakingDetector();

    expect(detector.observe(LOUD, 0), 'the first loud block did not start speaking').toBe(true);
    expect(
      detector.observe(LOUD, 20),
      'a per-audio-frame event would flood the reducer tens of times a second',
    ).toBeNull();
  });

  it('holds through the gaps between words', (): void => {
    const detector: SpeakingDetector = createSpeakingDetector();
    detector.observe(LOUD, 0);

    expect(
      detector.observe(QUIET, SPEAKING_HOLD_MS - 1),
      'the indicator dropped during an ordinary pause between words, which strobes it',
    ).toBeNull();
  });

  it('stops once the hold has elapsed', (): void => {
    const detector: SpeakingDetector = createSpeakingDetector();
    detector.observe(LOUD, 0);

    expect(detector.observe(QUIET, SPEAKING_HOLD_MS)).toBe(false);
  });

  it('does not flicker for a level sitting between the two thresholds', (): void => {
    const detector: SpeakingDetector = createSpeakingDetector();
    detector.observe(LOUD, 0);
    const between: number = (SPEAKING_ON_RMS + SPEAKING_OFF_RMS) / 2;

    // Well past the hold, so only the lower threshold is keeping it on.
    expect(
      detector.observe(between, SPEAKING_HOLD_MS * 10),
      'one threshold instead of two makes a borderline voice flicker the ring',
    ).toBeNull();
  });

  it('measures sustained energy, not peaks', (): void => {
    const click: Float32Array = new Float32Array(1000);
    click[0] = 1;
    const speech: Float32Array = new Float32Array(1000).fill(0.1);

    expect(
      rmsOf(click),
      'a single full-scale click read as loudly as speech, so a stray pop lights the ring',
    ).toBeLessThan(rmsOf(speech));
  });
});

describe('driving it from real audio', () => {
  // jsdom has no WebCodecs. Only the encoder classes CallSession's constructor
  // touches are stubbed -- the detection under test is pure arithmetic on the
  // samples, and stubbing it would test nothing.
  beforeEach((): void => {
    const noop: new () => unknown = class {
      configure(): void {}
      encode(): void {}
      close(): void {}
      get state(): string { return 'configured'; }
    };
    vi.stubGlobal('VideoEncoder', noop);
    vi.stubGlobal('AudioEncoder', noop);
    vi.stubGlobal('VideoDecoder', noop);
    vi.stubGlobal('AudioDecoder', noop);
    vi.stubGlobal('EncodedAudioChunk', class { constructor(public init: unknown) {} });
  });

  /** A minimal AudioData: only what reportSpeaking touches. */
  function audioBlock(amplitude: number): AudioData {
    const samples: Float32Array = new Float32Array(512).fill(amplitude);
    return {
      allocationSize: (): number => samples.byteLength,
      copyTo: (dest: Float32Array): void => { dest.set(samples); },
      close: (): void => undefined,
    } as unknown as AudioData;
  }

  it('reports speaking from audio handed to the session', async (): Promise<void> => {
    const { CallSession }: typeof import('../call-session') = await import('../call-session');
    const onSpeakingChanged: ReturnType<typeof vi.fn> = vi.fn();
    const session: InstanceType<typeof CallSession> = new CallSession({
      onFrame: vi.fn(),
      onStreamsChanged: vi.fn(),
      onSpeakingChanged,
      onCaptureFailed: vi.fn(),
      onNeedKeyframe: vi.fn(),
      onTrackEnded: vi.fn(),
    } as unknown as ConstructorParameters<typeof CallSession>[0]);

    session.encodeAudio(audioBlock(LOUD * 2));

    expect(
      onSpeakingChanged,
      'the detector exists but nothing calls it -- which is the original defect',
    ).toHaveBeenCalledWith(true);
  });

  it('says nothing for silence', async (): Promise<void> => {
    const { CallSession }: typeof import('../call-session') = await import('../call-session');
    const onSpeakingChanged: ReturnType<typeof vi.fn> = vi.fn();
    const session: InstanceType<typeof CallSession> = new CallSession({
      onFrame: vi.fn(),
      onStreamsChanged: vi.fn(),
      onSpeakingChanged,
      onCaptureFailed: vi.fn(),
      onNeedKeyframe: vi.fn(),
      onTrackEnded: vi.fn(),
    } as unknown as ConstructorParameters<typeof CallSession>[0]);

    session.encodeAudio(audioBlock(0));

    expect(onSpeakingChanged, 'silence lit the indicator').not.toHaveBeenCalled();
  });
});

describe('reaching the tile that renders it', () => {
  // The half that was nearly shipped inert. CallStage does NOT render the self
  // tile from `participants` -- it builds one synthetically with `cid: -1n` --
  // so dispatching a participant-keyed `speaking-changed` for the local cid
  // would have updated a record nothing reads, and the ring still never
  // appears. `selfSpeaking` exists for exactly that reason.
  it('carries self speech into state the self tile reads', async (): Promise<void> => {
    const { reduce }: typeof import('../call-reducer') = await import('../call-reducer');
    const { initialState }: typeof import('../call-state') = await import('../call-state');

    const after: ReturnType<typeof reduce> = reduce(initialState('c1'), { type: 'self-speaking-changed', speaking: true });

    expect(
      after?.selfSpeaking,
      'the self tile reads state.selfSpeaking, not a participant record',
    ).toBe(true);
  });

  it('does not require the local cid to be a participant', async (): Promise<void> => {
    const { reduce }: typeof import('../call-reducer') = await import('../call-reducer');
    const { initialState }: typeof import('../call-state') = await import('../call-state');

    const after: ReturnType<typeof reduce> = reduce(initialState('c1'), { type: 'self-speaking-changed', speaking: true });

    expect(
      after?.participants.size,
      'routing self speech through the participant map is what made it inert',
    ).toBe(0);
  });
});
