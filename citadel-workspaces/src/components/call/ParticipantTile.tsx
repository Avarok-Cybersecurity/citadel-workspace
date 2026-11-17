import { hasAnswered } from '@/lib/call/participant-presence';
import { useEffect, useRef , type RefObject } from 'react';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { MicOff, SignalLow, SignalMedium, Volume2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallParticipant } from '@/lib/call/call-state';
import { useRosterName } from './use-roster-name';

export type ConnectionQuality = 'good' | 'fair' | 'poor' | 'lost';

interface ParticipantTileProps {
  participant: CallParticipant;
  /** Attached to the <video> element. Absent until frames decode. */
  stream: MediaStream | null;
  /** Remote audio, played through a hidden element. Never set for self. */
  /**
   * Audio is NOT played here. `CallAudioHost`, mounted above the router, owns
   * every remote audio element — a tile only exists while its conversation is
   * on screen, and audio must not stop when the user navigates away.
   */
  isSelf: boolean;
  quality?: ConnectionQuality;
}

/**
 * One person in a call.
 *
 * The avatar is the DEFAULT render and video is the enhancement, not the other
 * way round. A tile that starts empty and waits for a stream flashes black at
 * the moment a call connects — which is exactly when the user is deciding
 * whether it worked.
 */
export function ParticipantTile({ participant, stream, isSelf, quality = 'good' }: ParticipantTileProps): JSX.Element {
  const videoRef: RefObject<HTMLVideoElement> = useRef<HTMLVideoElement>(null);
  const showVideo: boolean = participant.media.video && stream !== null;

  useEffect(() => {
    const element: HTMLVideoElement | null = videoRef.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    return (): void => {
      // Streams outlive tiles — the same one is reattached when the call moves
      // between the docked and expanded layouts — so detach rather than stop.
      element.srcObject = null;
    };
  }, [stream]);

  // Re-asked while the name is a placeholder: see use-roster-name.
  const learnedName: string = useRosterName(participant.cid, participant.username);
  const name: string = isSelf ? participant.username : learnedName;
  const label: string = isSelf ? 'You' : name;

  return (
    <div
      // `participant-tile-self` rather than the CID for your own tile. The
      // stage synthesises self with `cid: -1n`, so the testid used to be
      // `participant-tile--1` -- a magic number in the DOM that two specs had
      // to filter out by name to count REMOTE videos, which is a workaround
      // for a sentinel rather than a name for a thing.
      data-testid={isSelf ? 'participant-tile-self' : `participant-tile-${participant.cid.toString()}`}
      className={cn(
        'relative aspect-video overflow-hidden rounded-md border border-border bg-surface',
        'transition-shadow duration-150',
        // Ring, not a border swap: a border would reflow the grid every time
        // someone starts talking.
        participant.speaking && 'ring-2 ring-primary-accent ring-offset-1 ring-offset-card',
      )}
    >
      {showVideo ? (
        /* A live peer stream has no caption track to attach: captions
           presuppose prepared content, and there is no transcript for a
           conversation happening right now. Real-time captioning would be a
           speech-recognition feature, not a <track> element. */
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Muting our own tile is not cosmetic: without it the local mic
          // routes straight back out of the speakers.
          muted={isSelf}
          className="h-full w-full object-cover"
          aria-label={`${label} video`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <MemberAvatar username={participant.username} name={name} className="h-16 w-16 text-lg" />
        </div>
      )}

      {quality !== 'good' && (
        <div
          className="absolute right-1.5 top-1.5 rounded-md bg-background/75 p-1 backdrop-blur-sm"
          data-testid={`participant-quality-${participant.cid.toString()}`}
        >
          <QualityIcon quality={quality} />
          <span className="sr-only">{qualityLabel(quality)}</span>
        </div>
      )}

      <div
        className={cn(
          'absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1',
          'rounded-md bg-background/75 px-2 py-0.5 backdrop-blur-sm',
        )}
      >
        <span className="truncate text-xs text-foreground">{label}</span>
        {/* `invited` means the phone is still ringing. The tile read no status
            at all, so somebody who might never answer looked exactly like
            somebody who had. Text and not just a colour, per WCAG 1.4.1. */}
        {!hasAnswered(participant) && !isSelf && (
          <span className="shrink-0 text-xs text-muted-foreground" data-testid="participant-ringing">
            ringing…
          </span>
        )}
        {!participant.media.audio && (
          <>
            <MicOff className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
            <span className="sr-only">muted</span>
          </>
        )}
        {participant.speaking && participant.media.audio && (
          <>
            {/* A second, non-colour cue for the speaking ring: colour alone
                would carry meaning, which fails WCAG 1.4.1. */}
            <Volume2 className="h-3 w-3 shrink-0 text-primary-accent" aria-hidden="true" />
            <span className="sr-only">speaking</span>
          </>
        )}
      </div>
    </div>
  );
}

function QualityIcon({ quality }: { quality: ConnectionQuality }): JSX.Element {
  if (quality === 'lost') return <WifiOff className="h-3 w-3 text-destructive" aria-hidden="true" />;
  if (quality === 'poor') return <SignalLow className="h-3 w-3 text-destructive" aria-hidden="true" />;
  return <SignalMedium className="h-3 w-3 text-warning-emphasis" aria-hidden="true" />;
}

function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case 'lost':
      return 'Connection lost';
    case 'poor':
      return 'Poor connection';
    default:
      return 'Reduced connection quality';
  }
}
