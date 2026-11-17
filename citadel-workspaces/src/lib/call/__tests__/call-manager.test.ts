/**
 * Ordering is the whole difficulty of a call. A media session opened too early
 * holds a UDP channel for a call nobody answers; opened too late, the first
 * second of the call is lost. Neither shows up as an error.
 *
 * The transport is a fake rather than a mock of a real one: everything the
 * manager does to the outside world goes through that one interface by design,
 * so this exercises the real orchestration logic with no browser, no peer and no
 * internal service.
 */
import { describe, it, expect, vi, beforeEach     } from 'vitest';
import { MAX_OPEN_ATTEMPTS } from '../open-session-retry';
import { CallManager, MEDIA_WIRE_VERSION } from '../call-manager';
import type { CallTransport } from '../call-transport';
import type { CallCodecCapabilities, CallMediaKinds, CallSignalPayload } from '@/types/p2p-commands';
import type { CallState } from '../call-state';
import type { CallParticipant } from '@/lib/call/call-state';
import { DIRECT_CALL } from '../call-state';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const VIDEO: CallMediaKinds = { audio: true, video: true, screen: false };
const CAPS: CallCodecCapabilities = { audio: ['opus'], video: [] };

const BOB: bigint = 2n;
const CAROL: bigint = 3n;

interface Harness {
  manager: CallManager;
  transport: {
    openSession: ReturnType<typeof vi.fn>;
    closeSession: ReturnType<typeof vi.fn>;
    sendFrame: ReturnType<typeof vi.fn>;
    sendSignal: ReturnType<typeof vi.fn>;
  };
  states: Array<CallState | null>;
  signalsTo: (cid: bigint) => CallSignalPayload[];
  keyframeRequests: number[];
  /** Fires every timer the manager scheduled; returns how many fired. */
  fireTimers: () => number;
  cancelledTimers: () => number;
  /**
   * Awaits work that pauses between retries, moving the fake clock forward in
   * retry-gap steps so only the retry pauses fire. `fireTimers` would fire the
   * connect deadline too, which is a different outcome than the one under test.
   */
  settle: <T>(work: Promise<T>) => Promise<T>;
}

interface Timer { fn: () => void; delayMs: number; cancelled: boolean; fired: boolean }

function harness(): Harness {
  const transport: { openSession: ReturnType<typeof vi.fn>; closeSession: ReturnType<typeof vi.fn>; sendFrame: ReturnType<typeof vi.fn>; sendSignal: ReturnType<typeof vi.fn> } = {
    openSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    sendFrame: vi.fn(),
    sendSignal: vi.fn().mockResolvedValue(undefined),
  };
  const states: Array<CallState | null> = [];
  const keyframeRequests: number[] = [];
  const timers: Array<Timer> = [];
  let clock: number = 0;
  const manager: CallManager = new CallManager({
    transport: transport as unknown as CallTransport,
    selfCid: 1n,
    capabilities: CAPS,
    now: () => clock,
    schedule: (fn, delayMs) => {
      const timer: Timer = { fn, delayMs, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onStateChanged: (s) => states.push(s),
    // Named peers, so an assertion about a tile label is about the label and
    // not about whatever the roster happened to hold.
    resolvePeerName: (cid: bigint) => `peer-${cid}`,
    onKeyframeRequested: (track) => keyframeRequests.push(track),
  });

  return {
    manager,
    transport,
    states,
    signalsTo: (cid) =>
      transport.sendSignal.mock.calls.filter((c) => c[0] === cid).map((c) => c[1]),
    keyframeRequests,
    fireTimers: (): number => {
      const live: Timer[] = timers.filter((t): boolean => !t.cancelled && !t.fired);
      for (const t of live) { t.fired = true; t.fn(); }
      return live.length;
    },
    cancelledTimers: () => timers.filter((t) => t.cancelled).length,
    settle: async <T,>(work: Promise<T>): Promise<T> => {
      let finished: boolean = false;
      const watched: Promise<T> = work.finally((): void => { finished = true; });
      // Fire the next PENDING timer each round rather than a fixed step: the
      // retry gap backs off geometrically, so a step-sized advance stops firing
      // the moment a delay exceeds it and the awaited work never settles.
      //
      // Bounded below the connect deadline, which is 30s and is a different
      // outcome than the one under test.
      const RETRY_CEILING_MS: number = 10_000;
      for (let step: number = 0; step < MAX_OPEN_ATTEMPTS * 2 && !finished; step += 1) {
        await Promise.resolve();
        await Promise.resolve();
        if (finished) break;
        const due: Timer[] = timers
          .filter((t): boolean => !t.cancelled && !t.fired && t.delayMs < RETRY_CEILING_MS)
          .sort((a, b): number => a.delayMs - b.delayMs);
        const next: Timer | undefined = due[0];
        if (!next) break;
        clock += next.delayMs;
        next.fired = true;
        next.fn();
      }
      return watched;
    },
  };
}

interface InviteResult {
  kind: "CallInvite";
  call_id: string;
  media: CallMediaKinds;
  codecs: CallCodecCapabilities;
  media_wire_version: number;
  group?: { room_id: string; members: string[]; } | undefined;
  video_send_codec?: string | null | undefined;
}

function invite(callId: string = 'their-call', overrides: Partial<Extract<CallSignalPayload, { kind: 'CallInvite' }>> = {}): InviteResult {
  return {
    kind: 'CallInvite' as const,
    call_id: callId,
    media: VIDEO,
    codecs: CAPS,
    media_wire_version: MEDIA_WIRE_VERSION,
    ...overrides,
  };
}

describe('placing a call', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('rings every invitee without opening a media session yet', async () => {
    // Opening on dial would hold a UDP channel for a call that may never be
    // answered — and in a group, one per invitee.
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);

    expect(h.transport.sendSignal).toHaveBeenCalledTimes(2);
    expect(h.transport.openSession).not.toHaveBeenCalled();
    expect(h.manager.getState()?.status).toBe('ringing-out');
  });

  it('opens the media session only once the peer accepts', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });

    expect(h.transport.openSession).toHaveBeenCalledWith(BOB);
    // The transport resolves only on service confirmation, so a successful
    // open IS the peer being reachable — the call goes active and the clock
    // starts, instead of sitting at 00:00 forever.
    expect(h.manager.getState()?.status).toBe('active');
  });

  it('carries on with the rest of a group when one invite cannot be sent', async () => {
    h.transport.sendSignal.mockImplementation((cid: bigint) =>
      cid === CAROL ? Promise.reject(new Error('offline')) : Promise.resolve(undefined),
    );

    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);

    // Carol simply never rings; the call to Bob is unaffected.
    expect(h.manager.getState()?.participants.get(CAROL)?.status).toBe('declined');
    expect(h.manager.getState()?.status).toBe('ringing-out');
  });

  it('includes group membership so every peer builds the same mesh', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);

    const sent: CallSignalPayload = h.signalsTo(BOB)[0];
    expect(sent.kind).toBe('CallInvite');
    if (sent.kind === 'CallInvite') {
      expect(sent.group?.room_id).toBe('room-1');
      expect(sent.group?.members).toEqual([BOB.toString(), CAROL.toString()]);
    }
  });

  it('omits group membership for a 1:1 call', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);

    const sent: CallSignalPayload = h.signalsTo(BOB)[0];
    // Asserted, not branched on: `if (sent.kind === …)` ran ZERO assertions if
    // any other signal happened to go first, so the property this test exists
    // to pin was simply not checked.
    expect(sent.kind).toBe('CallInvite');
    if (sent.kind === 'CallInvite') expect(sent.group).toBeUndefined();
  });
});

describe('receiving a call', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('rings in, and accepting signals before opening the session', async () => {
    await h.manager.handleSignal(BOB, 'bob', invite());
    expect(h.manager.getState()?.status).toBe('ringing-in');

    await h.manager.accept(VIDEO, null);

    // The accept has to be on the wire first, so the peer is expecting frames
    // by the time the session exists.
    const order: number = h.transport.sendSignal.mock.invocationCallOrder[0];
    expect(order).toBeLessThan(h.transport.openSession.mock.invocationCallOrder[0]);
    expect(h.manager.getState()?.status).toBe('active');
  });

  it('declines an incompatible wire version instead of decoding garbage', async () => {
    await h.manager.handleSignal(BOB, 'bob', invite('x', { media_wire_version: MEDIA_WIRE_VERSION + 1 }));

    const sent: CallSignalPayload = h.signalsTo(BOB)[0];
    expect(sent.kind).toBe('CallDecline');
    if (sent.kind === 'CallDecline') expect(sent.reason).toBe('unsupported');
    // And no call state was created for it.
    expect(h.manager.getState()).toBeNull();
  });

  it('declines a second call as busy while already in one', async () => {
    await h.manager.handleSignal(BOB, 'bob', invite('first'));
    await h.manager.accept(AUDIO, null);
    h.transport.sendSignal.mockClear();

    await h.manager.handleSignal(CAROL, 'carol', invite('second'));

    const sent: CallSignalPayload = h.signalsTo(CAROL)[0];
    expect(sent.kind).toBe('CallDecline');
    if (sent.kind === 'CallDecline') expect(sent.reason).toBe('busy');
  });

  it('answering audio-only on a video invite is respected', async () => {
    await h.manager.handleSignal(BOB, 'bob', invite());
    await h.manager.accept(AUDIO, null);

    expect(h.manager.getState()?.selfMedia).toEqual(AUDIO);
  });
});

describe('receiving a group call', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  const groupInvite: (callId?: string) => { kind: "CallInvite"; call_id: string; media: CallMediaKinds; codecs: CallCodecCapabilities; media_wire_version: number; group?: { room_id: string; members: string[]; } | undefined; video_send_codec?: string | null | undefined; } = (callId = 'gc'): { kind: "CallInvite"; call_id: string; media: CallMediaKinds; codecs: CallCodecCapabilities; media_wire_version: number; group?: { room_id: string; members: string[]; } | undefined; video_send_codec?: string | null | undefined; } =>
    // The harness's own cid (1n) is in the roster on purpose: the invite names
    // EVERY invitee, and treating ourselves as a peer would mean signalling and
    // opening a session to our own cid.
    invite(callId, { group: { room_id: 'room-1', members: ['1', '2', '3'] } });

  it("adopts the caller's roster: the co-invitee is a participant, we are not", async () => {
    await h.manager.handleSignal(BOB, 'bob', groupInvite());

    const participants: Map<bigint, CallParticipant> | undefined = h.manager.getState()?.participants;
    expect([...(participants?.keys() ?? [])]).toEqual([BOB, CAROL]);
  });

  it('names a co-invitee from the roster, never by raw cid', async () => {
    // A cid is an identifier, not a name. This layer has no roster of its own,
    // so it must ask; the tile that renders the participant shows whatever
    // lands here, and for a long time that was a twenty-digit number.
    await h.manager.handleSignal(BOB, 'bob', groupInvite());

    const carol: CallParticipant | undefined = h.manager.getState()?.participants.get(CAROL);
    expect(carol?.username).toBe(`peer-${CAROL}`);
    expect(carol?.username).not.toBe(CAROL.toString());
  });

  it('accepting announces to every co-invitee, not only the caller', async () => {
    // This is how two invitees find each other without the caller relaying:
    // each one's accept reaches the whole roster.
    await h.manager.handleSignal(BOB, 'bob', groupInvite());
    await h.manager.accept(VIDEO, null);

    expect(h.signalsTo(CAROL).some((s) => s.kind === 'CallAccept')).toBe(true);
    // But no session yet: Carol has not answered, and a session needs both
    // sides to have accepted.
    expect(h.transport.openSession).toHaveBeenCalledTimes(1);
    expect(h.transport.openSession).toHaveBeenCalledWith(BOB);
  });

  it("opens the co-invitee's session when their accept arrives after ours", async () => {
    await h.manager.handleSignal(BOB, 'bob', groupInvite());
    await h.manager.accept(VIDEO, null);

    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'gc', codecs: CAPS, media: VIDEO, video_send_codec: null });

    expect(h.transport.openSession).toHaveBeenCalledWith(CAROL);
  });

  it("opens the co-invitee's session at accept when theirs arrived while we were still ringing", async () => {
    await h.manager.handleSignal(BOB, 'bob', groupInvite());
    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'gc', codecs: CAPS, media: VIDEO, video_send_codec: null });
    // Their answer must not open anything: we have no media yet and may still
    // decline.
    expect(h.transport.openSession).not.toHaveBeenCalled();

    await h.manager.accept(VIDEO, null);

    expect(h.transport.openSession).toHaveBeenCalledWith(BOB);
    expect(h.transport.openSession).toHaveBeenCalledWith(CAROL);
  });
});

describe('glare', () => {
  it('keeps exactly one call when both sides dial at once', async () => {
    // Both peers compute the same winner locally. Without this, either both
    // cancel or both wait.
    const ours: Harness = harness();
    await ours.manager.start('aaa', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    ours.transport.sendSignal.mockClear();
    await ours.manager.handleSignal(BOB, 'bob', invite('bbb'));

    const theirs: Harness = harness();
    await theirs.manager.start('bbb', [{ cid: 1n, username: 'alice' }], VIDEO, DIRECT_CALL, null);
    theirs.transport.sendSignal.mockClear();
    await theirs.manager.handleSignal(1n, 'alice', invite('aaa'));

    // 'bbb' > 'aaa', so the side holding bbb keeps theirs and the other yields.
    expect(ours.manager.getState()?.status).toBe('ringing-in');
    expect(theirs.manager.getState()?.status).toBe('ringing-out');
  });
});

describe('ending a call', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  async function activeCall(): Promise<void> {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    h.manager.markConnected(BOB);
  }

  it('tells the peer and releases the session', async () => {
    await activeCall();
    await h.manager.end('hangup');

    expect(h.signalsTo(BOB).some((s) => s.kind === 'CallEnd')).toBe(true);
    expect(h.transport.closeSession).toHaveBeenCalledWith(BOB);
    expect(h.manager.getState()?.status).toBe('ended');
  });

  it('releases the session when the peer ends first', async () => {
    await activeCall();
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });

    expect(h.transport.closeSession).toHaveBeenCalledWith(BOB);
    expect(h.manager.getState()?.status).toBe('ended');
  });

  it('closes each session exactly once', async () => {
    await activeCall();
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });
    await h.manager.end('hangup');

    expect(h.transport.closeSession).toHaveBeenCalledTimes(1);
  });

  it('keeps a group call alive when one participant leaves', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    h.manager.markConnected(BOB);
    h.manager.markConnected(CAROL);

    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });

    expect(h.manager.getState()?.status).toBe('active');
    expect(h.transport.closeSession).toHaveBeenCalledWith(CAROL);
    expect(h.transport.closeSession).not.toHaveBeenCalledWith(BOB);
  });
});

describe('sending frames', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  const frame: { track: number; kind: number; timestamp: number; flags: number; payload: Uint8Array<ArrayBuffer>; } = { track: 1, kind: 1, timestamp: 0, flags: 1, payload: new Uint8Array([1]) };

  it('fans one encoded frame out to every connected participant', async () => {
    // Encode once, send many: an encoder per peer is what makes mesh calls melt
    // laptops.
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });

    h.manager.sendFrame(frame);

    expect(h.transport.sendFrame).toHaveBeenCalledTimes(2);
  });

  it('does not send to a peer whose session is not open', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    h.manager.sendFrame(frame);

    // Still ringing: no session, so nothing to send into.
    expect(h.transport.sendFrame).not.toHaveBeenCalled();
  });

  it('stops sending to a peer who left', async () => {
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    await h.manager.handleSignal(CAROL, 'carol', { kind: 'CallEnd', call_id: 'c1', reason: 'hangup' });
    h.transport.sendFrame.mockClear();

    h.manager.sendFrame(frame);

    expect(h.transport.sendFrame).toHaveBeenCalledTimes(1);
    expect(h.transport.sendFrame).toHaveBeenCalledWith(BOB, frame);
  });

  it('sends nothing when there is no call', () => {
    h.manager.sendFrame(frame);
    expect(h.transport.sendFrame).not.toHaveBeenCalled();
  });
});

describe('media session failures', () => {
  it('fails a 1:1 call when the session cannot open, with the reason', async () => {
    const h: Harness = harness();
    h.transport.openSession.mockRejectedValue(new Error('peer connected without UDP'));

    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    await h.settle(
      h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO }),
    );

    // Every attempt was spent before the call was given up on: the service
    // parks the peer's UDP channel across a timed-out open precisely so the
    // next one picks it up, and one attempt threw that away.
    expect(h.transport.openSession).toHaveBeenCalledTimes(MAX_OPEN_ATTEMPTS);
    expect(h.manager.getState()?.status).toBe('failed');
    expect(h.manager.getState()?.reason).toMatch(/without UDP/);
  });

  it('drops only the affected peer in a group call', async () => {
    const h: Harness = harness();
    h.transport.openSession.mockImplementation((cid: bigint) =>
      cid === CAROL ? Promise.reject(new Error('no UDP')) : Promise.resolve(undefined),
    );

    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }, { cid: CAROL, username: 'carol' }], VIDEO, { kind: 'group', roomId: 'room-1' }, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });
    await h.settle(
      h.manager.handleSignal(CAROL, 'carol', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO }),
    );

    expect(h.manager.getState()?.status).not.toBe('failed');
    expect(h.manager.getState()?.participants.get(CAROL)?.status).toBe('left');
  });
});

describe('in-call signalling', () => {
  it('tells peers when the microphone is muted', async () => {
    // Explicit, not inferred from frames stopping: otherwise a muted peer and a
    // crashed one look identical.
    const h: Harness = harness();
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    h.transport.sendSignal.mockClear();

    await h.manager.setSelfMedia({ audio: false, video: true, screen: false });

    const sent: CallSignalPayload = h.signalsTo(BOB)[0];
    expect(sent.kind).toBe('CallMediaState');
  });

  it('hands keyframe requests straight to the encoder owner', async () => {
    // Buffered, these were a dead end (nothing drained the buffer) and grew
    // without bound at the far side's request rate.
    const h: Harness = harness();
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallKeyframeRequest', call_id: 'c1', track: 1 });

    expect(h.keyframeRequests).toEqual([1]);
  });
});

describe('signal hygiene', () => {
  it('ignores a retransmitted invite for the call we are already in', async () => {
    // The reliable layer delivers duplicates. Falling through to the busy
    // branch would decline OUR OWN call — killing it on both sides. Observed
    // live: the second copy arrived 55ms after the first.
    const h: Harness = harness();
    await h.manager.handleSignal(BOB, 'bob', invite('c1'));
    h.transport.sendSignal.mockClear();

    await h.manager.handleSignal(BOB, 'bob', invite('c1'));

    expect(h.transport.sendSignal).not.toHaveBeenCalled();
    expect(h.manager.getState()?.status).toBe('ringing-in');
  });

  it('ignores signals for a call other than the current one', async () => {
    // After glare, the loser declines the ABANDONED call; that decline must
    // not land on the surviving call and end it.
    const h: Harness = harness();
    await h.manager.start('bbb', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);

    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallDecline', call_id: 'aaa', reason: 'busy' });

    expect(h.manager.getState()?.status).toBe('ringing-out');
  });
});

describe('ring timeout', () => {
  it('ends an unanswered call instead of ringing forever with the mic open', async () => {
    const h: Harness = harness();
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);

    expect(h.fireTimers()).toBe(1);
    // The timer fires end('unanswered'), which signals peers before applying
    // the state change; let those (already-resolved) sends settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.manager.getState()?.status).toBe('ended');
    expect(h.manager.getState()?.reason).toBe('unanswered');
  });

  it('is retired the moment anyone answers', async () => {
    const h: Harness = harness();
    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], VIDEO, DIRECT_CALL, null);
    await h.manager.handleSignal(BOB, 'bob', { kind: 'CallAccept', call_id: 'c1', codecs: CAPS, media: VIDEO });

    // Asserts the consequence, not a timer count. Each status now arms its own
    // deadline and the liveness heartbeat schedules one once active, so
    // counting cancellations measures how many transitions happened. What this
    // pins is that an answered call is never ended as unanswered.
    h.fireTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.manager.getState()?.reason).not.toBe('unanswered');
  });

  it('fails a group call left parked in connecting', async () => {
    const h: Harness = harness();
    // Carol answers and her media session fails; Bob never answers. That
    // leaves {bob: invited, carol: left} — nobody active, not everyone gone,
    // so no reducer rule moves it. 'connecting' had no timer of its own: the
    // ring timer is retired on the transition INTO it, and the heartbeat
    // watchdog does not arm until 'active'. The call rested there forever
    // with the camera live.
    h.transport.openSession.mockRejectedValue(new Error('no UDP'));
    await h.manager.start(
      'c1',
      [
        { cid: BOB, username: 'bob' },
        { cid: CAROL, username: 'carol' },
      ],
      VIDEO,
      { kind: 'group', roomId: 'room-1' },
      null,
    );
    await h.settle(
      h.manager.handleSignal(CAROL, 'carol', {
        kind: 'CallAccept',
        call_id: 'c1',
        codecs: CAPS,
        media: VIDEO,
      }),
    );
    expect(h.manager.getState()?.status).toBe('connecting');

    expect(h.fireTimers()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.manager.getState()?.status).toBe('failed');
  });

  it('stops an incoming call ringing forever when the caller vanishes', async () => {
    const h: Harness = harness();
    // A killed caller tab sends no CallEnd, and nothing else guarded this
    // state — the ring tone looped until a human intervened.
    await h.manager.handleSignal(BOB, 'bob', invite('c1'));
    expect(h.manager.getState()?.status).toBe('ringing-in');

    expect(h.fireTimers()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.manager.getState()?.status).toBe('ended');
    expect(h.manager.getState()?.reason).toBe('unanswered');
  });
});

/**
 * `end()` used to await the CallEnd sends before closing sessions and applying
 * 'ended'. sendSignal is unbounded all the way down to the WASM messenger — the
 * constants file says so — so a wedged send left the stage up, the timer
 * ticking and the camera lit while Leave appeared to do nothing.
 *
 * `decline()` was always immune because it applies its state first. These pin
 * that the two now agree.
 */
describe('leaving a call does not wait on the network', () => {
  it('reaches ended even when the goodbye signal never settles', async () => {
    const h: Harness = harness();
    // Only the goodbye stalls. Wedging every send would hang start()'s own
    // invite instead, which is a different (and also unbounded) path.
    h.transport.sendSignal.mockImplementation((_cid: bigint, payload: CallSignalPayload) =>
      payload.kind === 'CallEnd' ? new Promise(() => {}) : Promise.resolve(),
    );

    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], AUDIO, DIRECT_CALL, null);
    await h.manager.end('hangup');

    const last: CallState | null = h.states[h.states.length - 1];
    expect(last?.status).toBe('ended');
  });

  it('still tells the peer goodbye when the send does settle', async () => {
    const h: Harness = harness();

    await h.manager.start('c1', [{ cid: BOB, username: 'bob' }], AUDIO, DIRECT_CALL, null);
    await h.manager.end('hangup');
    await Promise.resolve();

    expect(h.signalsTo(BOB).some((s) => s.kind === 'CallEnd')).toBe(true);
  });

});
