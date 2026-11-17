import type { ReactNode } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisabledWithTooltip } from '@/components/ui/DisabledWithTooltip';
import { useCall } from '@/lib/call/call-context';
import { groupCallEntryMode , type GroupCallEntryMode } from '@/lib/call/group-call-entry';
import type { RoomCallHome } from '@/lib/call/call-state';

export interface GroupCallMember {
  cid: bigint;
  username: string;
}

interface GroupCallControlsProps {
  /** The room this surface belongs to; its roomId scopes every decision to that call. */
  home: RoomCallHome;
  roomName: string;
  /** Everyone in the room except the current user. */
  members: GroupCallMember[];
  /** Members who cannot be rung because they are not connected with you (office rooms). */
  notConnected: readonly string[];
}

/**
 * The call controls on a group conversation header.
 *
 * Same philosophy as CallEntryButtons on the 1:1 header — always rendered,
 * disabled states carry their reason — plus the two things only groups need:
 * per-media cap refusals, and "Join call" when this room's call is already
 * ringing so two people cannot end up in two rival calls in one room.
 */
export function GroupCallControls({ home, roomName, members, notConnected }: GroupCallControlsProps): JSX.Element {
  const { call, capability, startCall, accept, leave } = useCall();
  const mode: GroupCallEntryMode = groupCallEntryMode(call, home.roomId, members.length, notConnected);

  if (mode.kind === 'in-call') {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => void leave()}
        aria-label={`Leave call in ${roomName}`}
        title={`Leave call in ${roomName}`}
        data-testid="group-call-leave"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  if (mode.kind === 'join') {
    return (
      <div className="flex items-center gap-1" data-testid="group-call-join">
        <EntryButton
          reason={mode.audioAllowed ? null : 'This call is full.'}
          label={`Join call in ${roomName} with audio (${mode.participantCount} in call)`}
          testId="group-call-join-audio"
          onClick={() => void accept({ audio: true, video: false, screen: false })}
          size="sm"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          <span>Join call</span>
          <span
            className="rounded-full bg-primary/15 px-1.5 text-xs font-medium text-primary-accent"
            aria-hidden="true"
          >
            {mode.participantCount}
          </span>
        </EntryButton>
        <EntryButton
          reason={mode.videoAllowed ? null : 'This call is full for video.'}
          label={`Join call in ${roomName} with video (${mode.participantCount} in call)`}
          testId="group-call-join-video"
          onClick={() => void accept({ audio: true, video: true, screen: false })}
        >
          <Video className="h-5 w-5" aria-hidden="true" />
        </EntryButton>
      </div>
    );
  }

  // 'start' and 'busy' render the same two buttons; only the reasons differ.
  const unsupported: string | null = !capability.supported
    ? capability.reason ?? 'Calls are not supported in this browser.'
    : null;
  const busy: string | null = mode.kind === 'busy' ? mode.reason : null;
  const audioReason: string | null = unsupported ?? busy ?? (mode.kind === 'start' ? mode.audioReason : null);
  const videoReason: string | null = unsupported ?? busy ?? (mode.kind === 'start' ? mode.videoReason : null);

  return (
    <div className="flex items-center gap-1">
      <EntryButton
        reason={audioReason}
        label={`Start audio call in ${roomName}`}
        testId="group-call-start-audio"
        onClick={() => void startCall(members, false, home)}
      >
        <Phone className="h-5 w-5" aria-hidden="true" />
      </EntryButton>
      <EntryButton
        reason={videoReason}
        label={`Start video call in ${roomName}`}
        testId="group-call-start-video"
        onClick={() => void startCall(members, true, home)}
      >
        <Video className="h-5 w-5" aria-hidden="true" />
      </EntryButton>
    </div>
  );
}

function EntryButton({
  reason,
  label,
  testId,
  onClick,
  size = 'icon',
  children,
}: {
  reason: string | null;
  label: string;
  testId: string;
  onClick: () => void;
  size?: 'icon' | 'sm';
  children: ReactNode;
}): JSX.Element {
  const button: JSX.Element = (
    <Button
      variant={size === 'sm' ? 'secondary' : 'ghost'}
      size={size}
      disabled={reason !== null}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={
        size === 'sm'
          ? 'gap-1.5'
          : 'text-muted-foreground hover:bg-surface hover:text-foreground'
      }
    >
      {children}
    </Button>
  );
  if (reason === null) return button;
  return (
    <DisabledWithTooltip disabled tooltip={reason}>
      {button}
    </DisabledWithTooltip>
  );
}
