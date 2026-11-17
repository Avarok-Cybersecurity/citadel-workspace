/**
 * A peer's screen share could stay invisible indefinitely.
 *
 * `ReceiverPool.accept` notifies the UI when a stream APPEARS — otherwise it
 * would re-render the whole call surface sixty times a second. It tracked video
 * and audio appearing, and not screen.
 *
 * `acceptScreen` builds a separate `screenSink`, reachable only through
 * `getScreenStream()`, so the existing `hadVideo`/`hadAudio` checks cannot see
 * it. The call context is a `useMemo` keyed on `streamsVersion`, and
 * `useStageShare` memoises on the Map that memo produces — so with no notify,
 * nothing recomputes and the share never renders.
 *
 * Order-dependent, which is why it presents as intermittent: if the first screen
 * FRAME arrives before the peer's `CallMediaState(screen: true)`, the context is
 * rebuilt for the state change and the share appears. If the state arrives first
 * — the common order, since state is sent on toggle and frames follow encoding —
 * `getRemoteScreenStreams()` is still empty at that moment, and the frame that
 * fills it notifies nobody. The viewer then waits for some unrelated transition:
 * a mic toggle, a participant change, a quality re-classification. In a quiet
 * call, potentially never.
 */
import { describe, it, expect } from 'vitest';
import { ReceiverPool } from '../receiver-pool';

const PEER: bigint = 7n;

/**
 * A pool whose receivers report whatever streams the test says they have.
 *
 * The real PeerReceiver needs WebCodecs decoders, which jsdom does not provide;
 * what is under test is the pool's notify RULE, not decoding.
 */
function poolWithStreams(streams: { video?: boolean; audio?: boolean; screen?: boolean }): {
  pool: ReceiverPool;
  notifies: number;
  bump: (next: { video?: boolean; audio?: boolean; screen?: boolean }) => void;
} {
  const state: { video?: boolean; audio?: boolean; screen?: boolean } = { ...streams };
  const counter: { n: number } = { n: 0 };

  const pool: ReceiverPool = new ReceiverPool({
    onStreamsChanged: (): void => { counter.n += 1; },
    onNeedKeyframe: (): void => {},
    fallbackCodec: () => 'vp8',
  });

  // Replace the receiver factory's product with a stub the test controls.
  // The frame is what creates the sink, so the stream appears DURING accept --
  // not before it. Bumping first made `hadVideo` already true and the positive
  // control failed, which is how this harness bug was caught.
  const pending: { next: { video?: boolean; audio?: boolean; screen?: boolean } | null } = { next: null };
  const stub: Record<string, unknown> = {
    accept: (): void => { if (pending.next) { Object.assign(state, pending.next); pending.next = null; } },
    getVideoStream: (): unknown => (state.video ? {} : null),
    getAudioStream: (): unknown => (state.audio ? {} : null),
    getScreenStream: (): unknown => (state.screen ? {} : null),
    close: (): void => {},
    handleGap: (): void => {},
  };
  (pool as unknown as { receivers: Map<bigint, unknown> }).receivers.set(PEER, stub);

  return {
    pool,
    get notifies(): number { return counter.n; },
    bump: (next): void => { pending.next = next; },
  };
}

describe('a stream appearing', () => {
  it('tells the UI when a screen share appears', () => {
    const p: ReturnType<typeof poolWithStreams> = poolWithStreams({ audio: true });
    const before: number = p.notifies;

    // The frame that creates the screen sink.
    p.bump({ screen: true });
    p.pool.accept(PEER, {} as never);

    expect(p.notifies).toBeGreaterThan(before);
  });

  it('still tells the UI when video appears', () => {
    // Positive control: the existing behaviour must survive.
    const p: ReturnType<typeof poolWithStreams> = poolWithStreams({});
    const before: number = p.notifies;

    p.bump({ video: true });
    p.pool.accept(PEER, {} as never);

    expect(p.notifies).toBeGreaterThan(before);
  });

  it('says nothing for a frame that changes no stream', () => {
    // The reason the rule exists: a notify per frame re-renders the call
    // surface sixty times a second.
    const p: ReturnType<typeof poolWithStreams> = poolWithStreams({ video: true, audio: true, screen: true });
    const before: number = p.notifies;

    p.pool.accept(PEER, {} as never);

    expect(p.notifies).toBe(before);
  });
});
