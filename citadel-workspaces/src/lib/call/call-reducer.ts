/**
 * The call state transition, and the participant helpers only it uses.
 *
 * Split out of call-state.ts, which had reached the file-length limit and was
 * being kept under it by collapsing multi-line returns onto single lines. The
 * limit exists to prompt exactly this split; compressing the source to satisfy
 * it keeps the number down and gives up the readability the number was standing
 * in for. call-state.ts is now the shape of a call, this is how it changes.
 */
import { stillInCall } from './participant-presence';
import type { CallMediaKinds } from '@/types/p2p-commands';
import {
  NO_MEDIA,
  type CallEvent,
  type CallParticipant,
  type CallState,
  type ParticipantStatus,
} from './call-state';

function newParticipant(
  cid: bigint,
  username: string,
  status: ParticipantStatus,
  media: CallMediaKinds,
): CallParticipant {
  return { cid, username, status, media, speaking: false };
}

function withParticipant(
  state: CallState,
  cid: bigint,
  update: (p: CallParticipant) => CallParticipant,
): CallState {
  const existing: CallParticipant | undefined = state.participants.get(cid);
  if (!existing) return state;
  const participants: Map<bigint, CallParticipant> = new Map(state.participants);
  participants.set(cid, update(existing));
  return { ...state, participants };
}

/** True once anyone is actually in the call with us. */
function anyoneActive(participants: Map<bigint, CallParticipant>): boolean {
  for (const p of participants.values()) {
    if (p.status === 'active' || p.status === 'connecting') return true;
  }
  return false;
}

/** True when every invitee has said no or gone. */
function everyoneGone(participants: Map<bigint, CallParticipant>): boolean {
  if (participants.size === 0) return false;
  for (const p of participants.values()) {
    if (stillInCall(p)) return false;
  }
  return true;
}

export function reduce(state: CallState | null, event: CallEvent): CallState | null {
  switch (event.type) {
    case 'invite-sent': {
      const participants: Map<bigint, CallParticipant> = new Map<bigint, CallParticipant>();
      for (const invitee of event.invitees) {
        participants.set(invitee.cid, newParticipant(invitee.cid, invitee.username, 'invited', NO_MEDIA));
      }
      return {
        callId: event.callId,
        status: 'ringing-out',
        home: event.home,
        outgoing: true,
        caller: null,
        selfMedia: event.media,
        selfSpeaking: false,
        participants,
        reason: null,
      };
    }

    case 'invite-received': {
      // A second invite for a call we are already in is a retransmit, not a new
      // call; adopting it would reset a live call back to ringing.
      if (state && state.callId === event.callId) return state;
      // The caller is already in the call they dialled — 'connecting', which is
      // what lets accept() open their session while co-invitees wait for their
      // own accepts. First into the map: the ringing card reads values()[0].
      const participants: Map<bigint, CallParticipant> = new Map<bigint, CallParticipant>([
        [event.from.cid, newParticipant(event.from.cid, event.from.username, 'connecting', event.media)],
      ]);
      // Co-invitees: every invitee holds the caller's roster, so the mesh can
      // form without the caller relaying anything.
      for (const other of event.others) {
        if (other.cid === event.from.cid) continue;
        participants.set(other.cid, newParticipant(other.cid, other.username, 'invited', NO_MEDIA));
      }
      return {
        callId: event.callId,
        status: 'ringing-in',
        home: event.home,
        outgoing: false,
        caller: event.from.cid,
        selfMedia: NO_MEDIA,
        selfSpeaking: false,
        participants,
        reason: null,
      };
    }

    default:
      break;
  }

  if (!state) return null;
  // Terminal is terminal. The reason on an ended or failed call is what the
  // caller is told ("bob declined the call."), and the first one is the true
  // one: a CallEnd arriving after a CallDecline, or a hang-up of a call that is
  // already over, re-ran "everyone gone" below and replaced 'rejected' with a
  // silent 'hangup' -- the call vanished without a word.
  if (state.status === 'ended' || state.status === 'failed') return state;

  switch (event.type) {
    case 'accepted-locally':
      if (state.status !== 'ringing-in') return state;
      return { ...state, status: 'connecting', selfMedia: event.media };

    case 'declined-locally':
      return { ...state, status: 'ended', reason: event.reason };

    case 'peer-accepted': {
      const next: CallState = withParticipant(state, event.cid, (p) => ({
        ...p,
        status: 'connecting',
        media: event.media,
      }));
      // Our own status only advances out of ringing once someone answers.
      return next.status === 'ringing-out' ? { ...next, status: 'connecting' } : next;
    }

    case 'peer-connected': {
      const next: CallState = withParticipant(state, event.cid, (p) => ({ ...p, status: 'active' }));
      return next.status === 'connecting' || next.status === 'ringing-out'
        ? { ...next, status: 'active' }
        : next;
    }

    case 'peer-declined': {
      const next: CallState = withParticipant(state, event.cid, (p) => ({ ...p, status: 'declined' }));
      // A 1:1 call where the one person said no is over. A group call carries on
      // — one person declining must not hang up on everybody else.
      return everyoneGone(next.participants)
        ? { ...next, status: 'ended', reason: event.reason }
        : next;
    }

    case 'peer-left': {
      const next: CallState = withParticipant(state, event.cid, (p) => ({ ...p, status: 'left' }));
      // The caller cancelling ends a still-ringing call outright — the seeded
      // co-invitees never answered, so "everyone gone" would never come true.
      if (next.status === 'ringing-in' && event.cid === next.caller) {
        return { ...next, status: 'ended', reason: 'hangup' };
      }
      if (anyoneActive(next.participants)) return next;
      return everyoneGone(next.participants)
        ? { ...next, status: 'ended', reason: 'hangup' }
        : next;
    }

    case 'peer-media-changed':
      return withParticipant(state, event.cid, (p) => ({ ...p, media: event.media }));

    case 'self-speaking-changed':
      return { ...state, selfSpeaking: event.speaking };

    case 'speaking-changed':
      return withParticipant(state, event.cid, (p) => ({ ...p, speaking: event.speaking }));

    case 'self-media-changed':
      return { ...state, selfMedia: event.media };

    case 'ended':
      return { ...state, status: 'ended', reason: event.reason };

    case 'failed':
      return { ...state, status: 'failed', reason: event.reason };

    default:
      return state;
  }
}

/**
 * Who should win when both sides call each other at the same instant.
 *
 * Without a rule, both sides see an incoming call while their own is ringing
 * out, and either both cancel or both wait. Comparing call ids is arbitrary but
 * consistent: both peers compute the same answer without another round trip.
 */
