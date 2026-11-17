import { Button } from '@/components/ui/button';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { DisabledWithTooltip } from '@/components/ui/DisabledWithTooltip';

interface CallEntryButtonsProps {
  /** Who is being called, for the accessible names. */
  targetName: string;
  /** False when there is no peer connection to place a call over. */
  canCall: boolean;
  /** True while a call with this target is already up. */
  inCall: boolean;
  /** False when this browser cannot do calls at all; carries the reason. */
  capability: { supported: boolean; reason?: string };
  onStartCall: (video: boolean) => void;
  onLeave: () => void;
}

/**
 * The audio and video buttons on a conversation header.
 *
 * Always rendered, never hidden. A control that disappears when unavailable
 * teaches the user the feature does not exist; one that is present and explains
 * itself teaches them what to fix. That is the whole reason the disabled state
 * carries a reason rather than just being greyed out.
 */
export function CallEntryButtons({
  targetName,
  canCall,
  inCall,
  capability,
  onStartCall,
  onLeave,
}: CallEntryButtonsProps): JSX.Element {
  if (inCall) {
    // One way out, and no second way in: offering "call" during a call is how
    // people end up starting a second one by accident.
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onLeave}
        aria-label={`Leave call with ${targetName}`}
        title={`Leave call with ${targetName}`}
        data-testid="call-leave-header"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  const reason: string | null = !capability.supported
    ? capability.reason ?? 'Calls are not supported in this browser.'
    : !canCall
      ? `${targetName} is not connected right now.`
      : null;

  if (reason) {
    return (
      <div className="flex items-center gap-1" data-testid="call-unavailable">
        <DisabledWithTooltip disabled tooltip={reason}>
          <Button variant="ghost" size="icon" disabled aria-label={`Call ${targetName}`}>
            <Phone className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DisabledWithTooltip>
        <DisabledWithTooltip disabled tooltip={reason}>
          <Button variant="ghost" size="icon" disabled aria-label={`Video call ${targetName}`}>
            <Video className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DisabledWithTooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onStartCall(false)}
        aria-label={`Start audio call with ${targetName}`}
        title={`Start audio call with ${targetName}`}
        data-testid="call-start-audio"
        className="text-muted-foreground hover:bg-surface hover:text-foreground"
      >
        <Phone className="h-5 w-5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onStartCall(true)}
        aria-label={`Start video call with ${targetName}`}
        title={`Start video call with ${targetName}`}
        data-testid="call-start-video"
        className="text-muted-foreground hover:bg-surface hover:text-foreground"
      >
        <Video className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
