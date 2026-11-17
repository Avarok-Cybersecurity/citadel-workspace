/**
 * What the call controls on a group conversation should offer right now.
 *
 * Pure so the group-specific rules — participant caps, join-versus-start,
 * one-call-per-tab — are testable without rendering anything. The component
 * renders whatever this decides and decides nothing itself.
 */

import { stillInCall } from './participant-presence';
import {
  MAX_AUDIO_PARTICIPANTS,
  MAX_VIDEO_PARTICIPANTS,
  callRoomId,
  canAddParticipant,
  type CallState,
} from './call-state';
import { callBusyReason } from './call-busy';

export type GroupCallEntryMode =
  /** No live call: offer to start one, with per-media reasons when the room outgrows the mesh. */
  | { kind: 'start'; audioReason: string | null; videoReason: string | null }
  /** This room's call is ringing us: offer to join it, never to start a rival. */
  | { kind: 'join'; participantCount: number; audioAllowed: boolean; videoAllowed: boolean }
  /** We are in this room's call (including one that failed and still owes its reason). */
  | { kind: 'in-call' }
  /** A call with a different conversation owns this tab's media. */
  | { kind: 'busy'; reason: string };

export function groupCallEntryMode(
  call: CallState | null,
  roomId: string,
  otherMemberCount: number,
  /** Members who cannot be rung because they are not connected with you; see callable-members. */
  notConnected: readonly string[],
): GroupCallEntryMode {
  if (call && call.status !== 'ended') {
    if (callRoomId(call.home) === roomId) {
      if (call.status === 'ringing-in') {
        // Someone already started this room's call. Joining is the only sane
        // offer — a "start" here puts two people in two calls in one room.
        const participantCount: number = [...call.participants.values()].filter(
          stillInCall,
        ).length;
        return {
          kind: 'join',
          participantCount,
          audioAllowed: canAddParticipant(call, false),
          videoAllowed: canAddParticipant(call, true),
        };
      }
      return { kind: 'in-call' };
    }
    // A failed call elsewhere is over in every way except its error panel;
    // letting it block calling HERE would strand the user with no way out.
    // `callBusyReason` owns that rule, shared with the 1:1 start path — which
    // had no busy check at all until it was extracted.
    const busy: string | null = callBusyReason(call);
    if (busy) return { kind: 'busy', reason: busy };
  }

  // Starting invites every other member, so the mesh must survive all of them
  // answering — refusing up front beats a call that collapses as it fills.
  return {
    kind: 'start',
    audioReason: startReason(otherMemberCount, notConnected, MAX_AUDIO_PARTICIPANTS, 'audio'),
    videoReason: startReason(otherMemberCount, notConnected, MAX_VIDEO_PARTICIPANTS, 'video'),
  };
}

function startReason(others: number, notConnected: readonly string[], cap: number, kind: 'audio' | 'video'): string | null {
  // Says what to DO, not just what is wrong. The roster comes from the room's
  // members, and joining a workspace does not make you a member of every room
  // in it — so this is the state a brand-new room is always in, and "no one
  // else is here" alone leaves the user with no idea that membership is the
  // lever.
  if (others === 0 && notConnected.length > 0) {
    const who: string = notConnected.length === 1 ? `${notConnected[0]} isn’t` : `${notConnected.join(', ')} aren’t`;
    return `${who} connected with you yet. Calls go directly between people — connect with them from Members first.`;
  }
  if (others === 0) {
    return 'No one else is in this conversation yet — add members to this room to call them.';
  }
  if (others > cap) {
    return `This group is too large for a ${kind} call — calls carry up to ${cap} other people, and this group has ${others}.`;
  }
  return null;
}
