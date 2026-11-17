import { CallStage } from './CallStage';
import { useCall } from '@/lib/call/call-context';
import { callRoomId } from '@/lib/call/call-state';

/**
 * The in-call stage, docked above one group conversation and no other.
 *
 * Scoped hard by roomId: a DM call (roomId null) or another room's call must
 * never render its stage over this conversation. 'ringing-in' also stays out —
 * until the user joins, ringing belongs to the global incoming-call card and
 * the header's Join button, not a stage the user is not in. 'failed' stays IN,
 * because the failure panel is the only explanation the user gets.
 */
export function GroupCallDock({ roomId }: { roomId: string }): JSX.Element | null {
  const {
    call,
    localStream,
    remoteStreams,
    remoteScreenStreams,
    screenStream,
    qualities,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    annotate,
    videoQuality,
    setVideoQuality,
    leave,
  } = useCall();

  const docked: boolean =
    call !== null &&
    callRoomId(call.home) === roomId &&
    call.status !== 'ended' &&
    call.status !== 'ringing-in';

  // The null check re-stated for the compiler: `docked` already implies it,
  // but boolean flags do not narrow the variable they were computed from.
  if (!docked || call === null) return null;

  return (
    <CallStage
      call={call}
      selfUsername="You"
      localStream={localStream}
      remoteStreams={remoteStreams}
      remoteScreenStreams={remoteScreenStreams}
      screenStream={screenStream}
      qualities={qualities}
      onToggleMic={() => void toggleMic()}
      onToggleCamera={() => void toggleCamera()}
      onToggleScreenShare={() => void toggleScreenShare()}
      onAnnotate={annotate}
      videoQuality={videoQuality}
      onVideoQualityChange={setVideoQuality}
      onLeave={() => void leave()}
    />
  );
}
