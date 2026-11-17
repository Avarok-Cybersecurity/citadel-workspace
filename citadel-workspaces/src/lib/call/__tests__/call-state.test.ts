/**
 * The cases here are the ones that need two people with good timing to
 * reproduce by hand: a decline crossing an accept, both sides dialling at once,
 * one person leaving a group call, a late 'ended' arriving after a failure.
 * They are exactly the cases a call product gets wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  glareWinner,
  canAddParticipant,
  MAX_VIDEO_PARTICIPANTS,
  type CallState,
} from '../call-state';
import { reduce } from '../call-reducer';
import type { CallMediaKinds } from '@/types/p2p-commands';
import { callHomeOf } from '../room-names';

const AUDIO: CallMediaKinds = { audio: true, video: false, screen: false };
const VIDEO: CallMediaKinds = { audio: true, video: true, screen: false };

const ALICE: { cid: bigint; username: string; } = { cid: 1n, username: 'alice' };
const BOB: { cid: bigint; username: string; } = { cid: 2n, username: 'bob' };
const CAROL: { cid: bigint; username: string; } = { cid: 3n, username: 'carol' };

function outgoing(invitees: { cid: bigint; username: string; }[] = [BOB], roomId: string | null = null): CallState {
  return reduce(null, {
    type: 'invite-sent',
    callId: 'call-1',
    home: callHomeOf(roomId, new Map<string, string>()),
    media: VIDEO,
    invitees,
  })!;
}

function incoming(others: Array<{ cid: bigint; username: string }> = [], roomId: string | null = null): CallState {
  return reduce(null, {
    type: 'invite-received',
    callId: 'call-2',
    home: callHomeOf(roomId, new Map<string, string>()),
    from: ALICE,
    media: VIDEO,
    others,
  })!;
}

describe('placing a call', () => {
  it('starts ringing out with every invitee pending', () => {
    const state: CallState = outgoing([BOB, CAROL]);

    expect(state.status).toBe('ringing-out');
    expect(state.outgoing).toBe(true);
    expect([...state.participants.values()].map((p) => p.status)).toEqual(['invited', 'invited']);
  });

  it('goes active once a peer connects', () => {
    let state: CallState = outgoing();
    state = reduce(state, { type: 'peer-accepted', cid: BOB.cid, media: VIDEO })!;
    expect(state.status).toBe('connecting');

    state = reduce(state, { type: 'peer-connected', cid: BOB.cid })!;
    expect(state.status).toBe('active');
  });

  it('ends when the only invitee declines', () => {
    let state: CallState = outgoing();
    state = reduce(state, { type: 'peer-declined', cid: BOB.cid, reason: 'busy' })!;

    expect(state.status).toBe('ended');
    expect(state.reason).toBe('busy');
  });
});

describe('receiving a call', () => {
  it('rings in, and accepting moves to connecting', () => {
    let state: CallState = incoming();
    expect(state.status).toBe('ringing-in');
    expect(state.outgoing).toBe(false);

    state = reduce(state, { type: 'accepted-locally', media: AUDIO })!;
    expect(state.status).toBe('connecting');
    // Answering audio-only on a video invite is the user's choice to make.
    expect(state.selfMedia).toEqual(AUDIO);
  });

  it('ignores a duplicate invite for a call already in progress', () => {
    // Retransmits happen. Adopting one would reset a live call to ringing.
    let state: CallState = incoming();
    state = reduce(state, { type: 'accepted-locally', media: VIDEO })!;
    state = reduce(state, { type: 'peer-connected', cid: ALICE.cid })!;

    const after: CallState = reduce(state, {
      type: 'invite-received',
      callId: 'call-2',
      home: { kind: 'direct' },
      from: ALICE,
      media: VIDEO,
      others: [],
    })!;

    expect(after.status).toBe('active');
  });

  it('cannot be accepted once it has ended', () => {
    let state: CallState = incoming();
    state = reduce(state, { type: 'ended', reason: 'timeout' })!;
    state = reduce(state, { type: 'accepted-locally', media: VIDEO })!;

    // Answering a call the caller already gave up on must not open a session
    // to someone who is no longer there.
    expect(state.status).toBe('ended');
  });
});

describe('receiving a group call', () => {
  it('seeds the caller first and every co-invitee, so all invitees hold the same roster', () => {
    // Without the co-invitees, two invitees in one group call would never
    // exchange a signal or a frame — each would know only the caller.
    const state: CallState = incoming([CAROL], 'room-1');

    expect([...state.participants.keys()]).toEqual([ALICE.cid, CAROL.cid]);
    // The caller is already in the call they dialled; the co-invitee has not
    // answered yet.
    expect(state.participants.get(ALICE.cid)?.status).toBe('connecting');
    expect(state.participants.get(CAROL.cid)?.status).toBe('invited');
  });

  it('records a co-invitee accepting while we are still ringing', () => {
    let state: CallState = incoming([CAROL], 'room-1');
    state = reduce(state, { type: 'peer-accepted', cid: CAROL.cid, media: VIDEO })!;

    expect(state.participants.get(CAROL.cid)?.status).toBe('connecting');
    // Their answer is not ours: we keep ringing until the user decides.
    expect(state.status).toBe('ringing-in');
  });

  it('does not duplicate the caller when the roster names them too', () => {
    const state: CallState = incoming([ALICE, CAROL], 'room-1');

    expect(state.participants.size).toBe(2);
    expect(state.participants.get(ALICE.cid)?.status).toBe('connecting');
  });

  it('stops ringing when the caller cancels, even with co-invitees still invited', () => {
    // Without this, "everyone gone" can never come true for a ringing invitee
    // — the seeded co-invitees never answered — and the phone rings forever
    // for a call that no longer exists.
    let state: CallState = incoming([CAROL], 'room-1');
    state = reduce(state, { type: 'peer-left', cid: ALICE.cid })!;

    expect(state.status).toBe('ended');
  });

  it('keeps ringing when a co-invitee bows out before we answer', () => {
    let state: CallState = incoming([CAROL], 'room-1');
    state = reduce(state, { type: 'peer-left', cid: CAROL.cid })!;

    expect(state.status).toBe('ringing-in');
  });
});

describe('group calls', () => {
  it('carries on when one participant declines', () => {
    // The bug worth guarding: treating any decline as "the call is over" hangs
    // up on everyone else in the room.
    let state: CallState = outgoing([BOB, CAROL], 'room-1');
    state = reduce(state, { type: 'peer-accepted', cid: BOB.cid, media: VIDEO })!;
    state = reduce(state, { type: 'peer-connected', cid: BOB.cid })!;
    state = reduce(state, { type: 'peer-declined', cid: CAROL.cid, reason: 'busy' })!;

    expect(state.status).toBe('active');
    expect(state.participants.get(BOB.cid)?.status).toBe('active');
  });

  it('stays active while at least one participant remains', () => {
    let state: CallState = outgoing([BOB, CAROL], 'room-1');
    state = reduce(state, { type: 'peer-connected', cid: BOB.cid })!;
    state = reduce(state, { type: 'peer-connected', cid: CAROL.cid })!;
    state = reduce(state, { type: 'peer-left', cid: CAROL.cid })!;

    expect(state.status).toBe('active');
  });

  it('ends once the last participant leaves', () => {
    let state: CallState = outgoing([BOB, CAROL], 'room-1');
    state = reduce(state, { type: 'peer-connected', cid: BOB.cid })!;
    state = reduce(state, { type: 'peer-connected', cid: CAROL.cid })!;
    state = reduce(state, { type: 'peer-left', cid: BOB.cid })!;
    state = reduce(state, { type: 'peer-left', cid: CAROL.cid })!;

    expect(state.status).toBe('ended');
  });

  it('ends when everyone declines', () => {
    let state: CallState = outgoing([BOB, CAROL], 'room-1');
    state = reduce(state, { type: 'peer-declined', cid: BOB.cid, reason: 'busy' })!;
    expect(state.status).toBe('ringing-out');

    state = reduce(state, { type: 'peer-declined', cid: CAROL.cid, reason: 'rejected' })!;
    expect(state.status).toBe('ended');
  });

  it('caps participants so the mesh stays survivable', () => {
    const many: { cid: bigint; username: string; }[] = Array.from({ length: MAX_VIDEO_PARTICIPANTS }, (_, i): { cid: bigint; username: string; } => ({
      cid: BigInt(i + 10),
      username: `user${i}`,
    }));
    const state: CallState = outgoing(many, 'room-1');

    expect(canAddParticipant(state, true)).toBe(false);
    // Audio-only is far cheaper, so the same room still has headroom.
    expect(canAddParticipant(state, false)).toBe(true);
  });

  it('frees a slot when someone leaves', () => {
    const many: { cid: bigint; username: string; }[] = Array.from({ length: MAX_VIDEO_PARTICIPANTS }, (_, i): { cid: bigint; username: string; } => ({
      cid: BigInt(i + 10),
      username: `user${i}`,
    }));
    let state: CallState = outgoing(many, 'room-1');
    state = reduce(state, { type: 'peer-left', cid: 10n })!;

    expect(canAddParticipant(state, true)).toBe(true);
  });
});

describe('in-call state', () => {
  it('tracks a peer muting without dropping them', () => {
    let state: CallState = outgoing();
    state = reduce(state, { type: 'peer-connected', cid: BOB.cid })!;
    state = reduce(state, {
      type: 'peer-media-changed',
      cid: BOB.cid,
      media: { audio: false, video: true, screen: false },
    })!;

    // Muting must be explicit state, not inferred from frames stopping —
    // otherwise a muted peer is indistinguishable from a crashed one.
    expect(state.participants.get(BOB.cid)?.media.audio).toBe(false);
    expect(state.participants.get(BOB.cid)?.status).toBe('active');
    expect(state.status).toBe('active');
  });

  it('ignores events for a participant who is not in the call', () => {
    const state: CallState = outgoing();
    const after: CallState = reduce(state, { type: 'peer-connected', cid: 999n })!;

    expect(after.participants.has(999n)).toBe(false);
  });
});

describe('terminal states', () => {
  it('does not let a late end overwrite a failure', () => {
    // Both arrive when a call dies badly. The failure is what the user needs to
    // see; "hung up" would hide it.
    let state: CallState = outgoing();
    state = reduce(state, { type: 'failed', reason: 'no UDP channel' })!;
    state = reduce(state, { type: 'ended', reason: 'hangup' })!;

    expect(state.status).toBe('failed');
    expect(state.reason).toBe('no UDP channel');
  });

  it('does not let a late failure overwrite a clean end', () => {
    let state: CallState = outgoing();
    state = reduce(state, { type: 'ended', reason: 'hangup' })!;
    state = reduce(state, { type: 'failed', reason: 'transport closed' })!;

    expect(state.status).toBe('ended');
  });
});

describe('glare', () => {
  it('resolves both-dialled-at-once the same way on both sides', () => {
    // Each peer computes it locally with no extra round trip, and they must
    // agree — otherwise both cancel, or both wait forever.
    expect(glareWinner('b', 'a')).toBe('ours');
    expect(glareWinner('a', 'b')).toBe('theirs');
  });

  it('is symmetric: exactly one side wins', () => {
    const ours: "ours" | "theirs" = glareWinner('call-aaa', 'call-bbb');
    const theirs: "ours" | "theirs" = glareWinner('call-bbb', 'call-aaa');

    expect(ours === 'ours' ? theirs : ours).toBe('theirs');
  });
});
