import { stillInCall } from '@/lib/call/participant-presence';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { ParticipantTile, type ConnectionQuality } from './ParticipantTile';
import { CallControls } from './CallControls';
import type { CallParticipant, CallState } from '@/lib/call/call-state';
import { registerCallStage } from './call-stage-presence';
import { ScreenShareView } from './ScreenShareView';
import { useAnnotations } from './use-annotations';
import { useStageShare } from './use-stage-share';
import { useRosterName } from './use-roster-name';
import { cameraControlUsable, mediaControlsUsable, type ControlAvailability } from './call-control-availability';
import { VideoSettingsModal } from './VideoSettingsModal';
import { canShareScreen } from '@/lib/call/screen-capability';
import type { VideoQuality } from '@/lib/call/video-quality';
import { callLabel, ConnectingBanner, ErrorPanel, OutgoingCallPanel } from './CallStagePanels';
import { useStatusSince } from './use-status-since';
import { failedCallTitle } from '@/lib/call/call-failure-detail';

interface CallStageProps {
  call: CallState;
  selfUsername: string;
  localStream: MediaStream | null;
  remoteStreams: Map<bigint, MediaStream>;
  /** Shared screens by sharer CID; a peer can be in here and in remoteStreams. */
  remoteScreenStreams?: Map<bigint, MediaStream>;
  /** This tab's own share, so the sharer sees what everyone else sees. */
  screenStream?: MediaStream | null;
  onToggleScreenShare?: () => void;

  /** Sends one drawn point to the other participants. */
  onAnnotate?: (stroke: { strokeId: string; point: { x: number; y: number } }) => void;
  /** The chosen quality ceiling, and how to change it. Absent hides the control. */
  videoQuality?: VideoQuality;
  onVideoQualityChange?: (quality: VideoQuality) => void;
  /** Remote audio per peer; each tile owns playing its participant's sound. */
  qualities?: Map<bigint, ConnectionQuality>;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
}

/**
 * The in-call surface, docked above the conversation it belongs to.
 *
 * Docked rather than a route or a modal. A route would fight the existing
 * /messages and /groups model and kill media on unmount; a modal would block the
 * file transfers and documents people plausibly want DURING a call. Sitting
 * above the message list keeps the chat usable, which is the entire reason to
 * put calling inside a messaging product.
 */
export function CallStage({
  call,
  selfUsername,
  localStream,
  remoteStreams,
  remoteScreenStreams,
  screenStream,
  qualities,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onAnnotate,
  videoQuality,
  onVideoQualityChange,
  onLeave,
}: CallStageProps): JSX.Element {
  const [videoSettingsOpen, setVideoSettingsOpen] = useState<boolean>(false);
  // Tells OngoingCallBar to stand down: the call's own surface is on screen, so
  // the user can already see and end the call from here.
  useEffect(() => registerCallStage(), []);

  const visible: CallParticipant[] = useMemo(
    () => [...call.participants.values()].filter(stillInCall),
    [call.participants],
  );

  const anyVideo: boolean = call.selfMedia.video || visible.some((p): boolean => p.media.video);
  const tileCount: number = visible.length + 1;

  const controls: ControlAvailability = mediaControlsUsable(call.status);
  const camera: ControlAvailability = cameraControlUsable(call.status, localStream);
  const { share, someoneElseIsSharing } = useStageShare({
    visible,
    remoteScreenStreams,
    screenStream,
    selfSharing: call.selfMedia.screen,
    selfUsername,
  });

  // The share's name was frozen with the participant's; see use-roster-name.
  const sharerName: string = useRosterName(share?.cid ?? null, share?.name ?? '');

  const { strokes, beginStroke, addPoint, endStroke } = useAnnotations({
    callId: share ? call.callId : null,
    author: selfUsername,
    send: onAnnotate,
  });

  const statusSince: number = useStatusSince(call.status);

  return (
    <section
      data-testid="call-stage"
      aria-label={callLabel(call, visible.length)}
      // How long this status has held, for a reader who needs to tell "the
      // deadline never armed" from "the call keeps re-entering this status".
      // Data rather than the accessible name: a name that changes every second
      // is one a screen reader re-announces every second.
      data-status-since={statusSince}
      className="m-3 rounded-lg border border-border bg-card p-3"
    >
      {call.status === 'failed' ? (
        <ErrorPanel
          title={failedCallTitle(call.reason)}
          detail={call.reason ?? 'Something went wrong setting up the call.'}
        />
      ) : call.status === 'ringing-out' ? (
        <OutgoingCallPanel invitees={visible} onCancel={onLeave} />
      ) : (
        <>
          {/* Accept-to-first-frame gap: without this the stage looks frozen at
              the exact moment the user is judging whether the call worked. */}
          {call.status === 'connecting' && <ConnectingBanner />}

          {share && (
            <ScreenShareView
              stream={share.stream}
              sharerName={sharerName}
              isSelf={share.isSelf}
              strokes={strokes}
              onPoint={addPoint}
              onStrokeStart={beginStroke}
              onStrokeEnd={endStroke}
            />
          )}

          <div
          className={cn(
            'grid gap-2',
            // Audio-only stays a compact strip: a grid of avatars is a lot of
            // space to spend saying nothing.
            // A screen on the stage takes the room's attention; the faces
            // become a strip beside it rather than competing for the same
            // space. Four across at most, because a fifth 60px face says
            // nothing that the name under it does not.
            share && 'grid-cols-3 sm:grid-cols-4 [&>*]:aspect-video',
            !share && !anyVideo && 'grid-cols-1',
            !share && anyVideo && tileCount <= 2 && 'grid-cols-1 sm:grid-cols-2',
            !share && anyVideo && tileCount > 2 && 'grid-cols-2',
          )}
          data-testid="call-participants"
        >
          {visible.map((participant) => (
            <ParticipantTile
              key={participant.cid.toString()}
              participant={participant}
              stream={remoteStreams.get(participant.cid) ?? null}
              isSelf={false}
              quality={qualities?.get(participant.cid) ?? 'good'}
            />
          ))}
          <ParticipantTile
            participant={{
              cid: -1n,
              username: selfUsername,
              status: 'active',
              media: call.selfMedia,
              speaking: call.selfSpeaking,
            }}
            stream={localStream}
            isSelf
          />
          </div>
        </>
      )}

      <div className="mt-3">
        <CallControls
          media={call.selfMedia}
          canToggleVideo={camera.usable}
          canToggleMic={controls.usable}
          micBlockedReason={controls.reason}
          onToggleMic={onToggleMic}
          onToggleCamera={onToggleCamera}
          onToggleScreenShare={onToggleScreenShare}
          // Somebody else's share owns the stage, so this tab's button is off
          // while it lasts -- with the exception of stopping a share of its
          // own, which must always be possible.
          // Asked here rather than carried through the context: the provider is
          // mounted app-wide, so a capability probe in it puts getDisplayMedia
          // and the WebCodecs feature test on the landing page's critical path.
          // This component is only ever in a call.
          // A share of this tab's own must always be stoppable, including on a
          // call that just failed underneath it -- otherwise the screen stays
          // captured with no control that takes it back.
          canShareScreen={(controls.usable || call.selfMedia.screen) && canShareScreen() && !someoneElseIsSharing}
          shareBlockedReason={
            someoneElseIsSharing && share
              ? `${sharerName} is sharing — one screen at a time`
              : !canShareScreen()
                ? 'This browser cannot share a screen'
                : controls.reason
          }
          videoBlockedReason={camera.reason}
          onOpenVideoSettings={onVideoQualityChange ? (): void => setVideoSettingsOpen(true) : undefined}
          onLeave={onLeave}
          running={call.status === 'active'}
        />
      </div>

      {onVideoQualityChange && (
        <VideoSettingsModal
          open={videoSettingsOpen}
          onOpenChange={setVideoSettingsOpen}
          quality={videoQuality ?? 'auto'}
          onQualityChange={onVideoQualityChange}
        />
      )}
    </section>
  );
}
