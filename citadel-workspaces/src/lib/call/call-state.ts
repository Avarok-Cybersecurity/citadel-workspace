/**
 * Call lifecycle as a pure reducer.
 *
 * Calls are where races live: both sides pressing call at once, a decline
 * crossing an accept, an end arriving for a call that already ended, a
 * participant leaving mid-connect. Keeping the rules here — with no media, no
 * sockets and no React — is what makes those cases testable instead of
 * reproducible only by two humans with good timing.
 */

import { stillInCall } from './participant-presence';
import type {
  CallDeclineReason,
  CallEndReason,
  CallMediaKinds,
} from '@/types/p2p-commands';

export type CallStatus =
  | 'ringing-out'
  | 'ringing-in'
  | 'connecting'
  | 'active'
  | 'ended'
  | 'failed';

export type ParticipantStatus = 'invited' | 'connecting' | 'active' | 'left' | 'declined';

export interface CallParticipant {
  cid: bigint;
  username: string;
  status: ParticipantStatus;
  media: CallMediaKinds;
  speaking: boolean;
}

/**
 * Where a call's conversation lives: what "Return" opens.
 *
 * `roomId` is the call's scope on the wire, and for an office or room it is the
 * node's CHAT CHANNEL id, not a page anyone can open. Carrying only that id sent
 * Return on a room call to `/groups/<channel>`, which is "Group not found".
 */
export type CallHome =
  | { kind: 'direct' }
  | { kind: 'group'; roomId: string }
  | { kind: 'node'; roomId: string; nodeId: string };

export type RoomCallHome = Exclude<CallHome, { kind: 'direct' }>;

export const DIRECT_CALL: CallHome = { kind: 'direct' };

/** The call's scope on the wire; null for a 1:1 call. */
export function callRoomId(home: CallHome): string | null {
  return home.kind === 'direct' ? null : home.roomId;
}

export interface CallState {
  callId: string;
  status: CallStatus;
  home: CallHome;
  /** True when we placed the call. Decides who wins a glare collision. */
  outgoing: boolean;
  /** Who dialled — null when we did. Their hangup ends a still-ringing call. */
  caller: bigint | null;
  selfMedia: CallMediaKinds;
  /**
   * Whether THIS person is speaking.
   *
   * Separate from a participant's `speaking` because the self tile is not a
   * participant: CallStage builds it synthetically with `cid: -1n`, so a
   * `speaking-changed` event carrying the real self cid would update a
   * participant record the self tile never reads.
   */
  selfSpeaking: boolean;
  participants: Map<bigint, CallParticipant>;
  /** Set when status is 'failed' or 'ended', for the UI to explain itself. */
  reason: string | null;
}

/** Someone a call knows about, before they are a full participant. */
export interface CallPeerRef {
  cid: bigint;
  username: string;
}

export type CallEvent =
  | {
      type: 'invite-sent';
      callId: string;
      home: CallHome;
      media: CallMediaKinds;
      invitees: CallPeerRef[];
    }
  | {
      type: 'invite-received';
      callId: string;
      home: CallHome;
      from: CallPeerRef;
      media: CallMediaKinds;
      /** The caller's other invitees, so this peer can build the same mesh. */
      others: CallPeerRef[];
    }
  | { type: 'accepted-locally'; media: CallMediaKinds }
  | { type: 'declined-locally'; reason: CallDeclineReason }
  | { type: 'peer-accepted'; cid: bigint; media: CallMediaKinds }
  | { type: 'peer-declined'; cid: bigint; reason: CallDeclineReason }
  | { type: 'peer-media-changed'; cid: bigint; media: CallMediaKinds }
  | { type: 'peer-connected'; cid: bigint }
  | { type: 'peer-left'; cid: bigint }
  | { type: 'self-media-changed'; media: CallMediaKinds }
  | { type: 'speaking-changed'; cid: bigint; speaking: boolean }
  | { type: 'self-speaking-changed'; speaking: boolean }
  | { type: 'ended'; reason: CallEndReason }
  | { type: 'failed'; reason: string };

export const NO_MEDIA: CallMediaKinds = { audio: false, video: false, screen: false };

// Beyond these, a mesh sender's uplink and encoder count stop being survivable.
export const MAX_VIDEO_PARTICIPANTS: number = 8;
export const MAX_AUDIO_PARTICIPANTS: number = 12;

export function initialState(callId: string): CallState {
  return {
    callId,
    status: 'ringing-out',
    home: DIRECT_CALL,
    outgoing: true,
    caller: null,
    selfMedia: NO_MEDIA,
    selfSpeaking: false,
    participants: new Map(),
    reason: null,
  };
}

export function glareWinner(ourCallId: string, theirCallId: string): 'ours' | 'theirs' {
  return ourCallId > theirCallId ? 'ours' : 'theirs';
}

/** Whether another participant can join without overloading the mesh. */
export function canAddParticipant(state: CallState, withVideo: boolean): boolean {
  const active: number = [...state.participants.values()].filter(
    stillInCall,
  ).length;
  return active < (withVideo ? MAX_VIDEO_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS);
}
