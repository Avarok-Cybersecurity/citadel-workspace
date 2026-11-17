import { useMemo } from 'react';
import type { CallParticipant } from '@/lib/call/call-state';

export interface StageShare {
  stream: MediaStream;
  name: string;
  /** Whose share it is, for re-asking the roster; null for this tab's own. */
  cid: bigint | null;
  isSelf: boolean;
}

/**
 * Whose screen the stage is showing.
 *
 * One at a time, and a remote share wins over this tab's own: if somebody else
 * is already sharing, that is what the room is looking at. Two screens side by
 * side halves both of them, which defeats the purpose — people share screens so
 * that others can READ something.
 *
 * A participant must be BOTH sending screen frames and announcing `media.screen`
 * to hold the stage. The frames alone would keep a stopped share up on the last
 * frame it sent, and the announcement alone would open an empty stage.
 */
export function useStageShare({
  visible,
  remoteScreenStreams,
  screenStream,
  selfSharing,
  selfUsername,
}: {
  visible: readonly CallParticipant[];
  remoteScreenStreams?: Map<bigint, MediaStream>;
  screenStream?: MediaStream | null;
  selfSharing: boolean;
  selfUsername: string;
}): { share: StageShare | null; someoneElseIsSharing: boolean } {
  return useMemo(() => {
    for (const participant of visible) {
      const stream: MediaStream | undefined = remoteScreenStreams?.get(participant.cid);
      if (stream && participant.media.screen) {
        return {
          share: { stream, name: participant.username, cid: participant.cid, isSelf: false },
          someoneElseIsSharing: true,
        };
      }
    }
    if (screenStream && selfSharing) {
      return {
        share: { stream: screenStream, name: selfUsername, cid: null, isSelf: true },
        someoneElseIsSharing: false,
      };
    }
    return { share: null, someoneElseIsSharing: false };
  }, [visible, remoteScreenStreams, screenStream, selfSharing, selfUsername]);
}
