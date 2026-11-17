/**
 * The sender-side quality ladder only moves if something feeds it.
 *
 * Nothing did. `applyQualityReport` had no production caller, so congestion sat
 * at rung 0 for the life of every call: the encoder was configured once at full
 * quality and never reconfigured, and four of the five ladder rungs were
 * unreachable. The adaptation was written, tested in isolation, and never ran.
 *
 * These drive the real wiring — manager, signal handling, liveness binding —
 * to prove the loop closes in both directions.
 */
import { describe, it, expect, vi, beforeEach    } from 'vitest';
import { CallManager } from '../call-manager';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds, CallSignalPayload } from '@/types/p2p-commands';
import { DIRECT_CALL } from '../call-state';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };
const BOB: bigint = 2n;

type Link = 'good' | 'fair' | 'poor' | 'lost';

function harness(observed?: (cid: bigint) => Link | undefined): { manager: CallManager; transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn>; }; reported: Link[]; tick: () => void; heartbeats: () => { kind: "CallHeartbeat"; call_id: string; link?: "good" | "fair" | "poor" | "lost"; }[]; active: () => Promise<void>; } {
  const timers: Array<() => void> = [];
  const reported: Link[] = [];
  const transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn> } = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal: vi.fn().mockResolvedValue(undefined),
  };
  const manager: CallManager = new CallManager({
    transport: transport as unknown as CallTransport,
    selfCid: 1n,
    capabilities: CAPS,
    now: () => 0,
    schedule: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
    onStateChanged: () => undefined,
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: () => undefined,
    observedLink: observed,
    onLinkReported: (link) => reported.push(link),
  });
  return {
    manager,
    transport,
    reported,
    tick: (): void => timers.splice(0).forEach((fn): void => fn()),
    heartbeats: (): { kind: "CallHeartbeat"; call_id: string; link?: "good" | "fair" | "poor" | "lost"; }[] =>
      transport.sendSignal.mock.calls
        .map((c) => c[1] as CallSignalPayload)
        .filter((s) => s.kind === 'CallHeartbeat'),
    active: async (): Promise<void> => {
      await manager.start('c1', [{ cid: BOB, username: 'bob' }], AUDIO, DIRECT_CALL, null);
      await manager.handleSignal(BOB, 'bob', {
        kind: 'CallAccept',
        call_id: 'c1',
        codecs: CAPS,
        media: AUDIO,
      });
    },
  };
}

describe('quality feedback, outbound', () => {
  it('tells a peer how their stream is reaching us', async () => {
    const h: ReturnType<typeof harness> = harness((): "poor" => 'poor');
    await h.active();
    h.tick();

    const beat: { kind: "CallHeartbeat"; call_id: string; link?: "good" | "fair" | "poor" | "lost"; } = h.heartbeats()[0];
    expect(beat).toBeDefined();
    expect(beat).toMatchObject({ kind: 'CallHeartbeat', link: 'poor' });
  });

  it('says nothing when it has not seen enough media to judge', async () => {
    // Absence of evidence must not read as a healthy link, or a call would
    // report 'good' before a single frame had arrived.
    const h: ReturnType<typeof harness> = harness((): undefined => undefined);
    await h.active();
    h.tick();

    const beat: { kind: "CallHeartbeat"; call_id: string; link?: "good" | "fair" | "poor" | "lost"; } = h.heartbeats()[0];
    expect(beat).toMatchObject({ kind: 'CallHeartbeat' });
    // Asserted as absent, not merely 'not good': the key must not reach the
    // wire at all, and `not.toHaveProperty('link', 'good')` would pass just as
    // happily on an explicit undefined.
    expect('link' in beat).toBe(false);
  });
});

describe('quality feedback, inbound', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('applies a peer’s verdict on our stream', async () => {
    await h.active();
    await h.manager.handleSignal(BOB, 'bob', {
      kind: 'CallHeartbeat',
      call_id: 'c1',
      link: 'poor',
    });

    expect(h.reported).toEqual(['poor']);
  });

  it('ignores a heartbeat from a peer that carries no verdict', async () => {
    // Wire compatibility: a peer predating this field sends a bare heartbeat,
    // and the sender must hold its current rung rather than treat the missing
    // field as a clean link and climb.
    await h.active();
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallHeartbeat', call_id: 'c1' });

    expect(h.reported).toEqual([]);
  });
});
