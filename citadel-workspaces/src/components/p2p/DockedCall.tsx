/**
 * The direct call, docked above the messages, so the conversation stays usable
 * during a call -- which is the entire reason to put calling inside a messenger.
 * Nothing while there is no call.
 */
import { CallStage } from '@/components/call/CallStage';
import type { DirectCallBinding } from './hooks/use-direct-call';

export function DockedCall({ binding }: { binding: DirectCallBinding }): JSX.Element | null {
  if (!binding.call) return null;
  return (
    <CallStage
      call={binding.call}
      selfUsername="You"
      localStream={binding.localStream}
      remoteStreams={binding.remoteStreams}
      remoteScreenStreams={binding.remoteScreenStreams}
      screenStream={binding.screenStream}
      qualities={binding.qualities}
      onToggleMic={binding.toggleMic}
      onToggleCamera={binding.toggleCamera}
      onToggleScreenShare={binding.toggleScreenShare}
      onAnnotate={binding.annotate}
      videoQuality={binding.videoQuality}
      onVideoQualityChange={binding.setVideoQuality}
      onLeave={binding.leave}
    />
  );
}
