import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Gauge, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Video, VideoOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallMediaKinds } from '@/types/p2p-commands';
import { useCallDuration } from './use-call-duration';

interface CallControlsProps {
  media: CallMediaKinds;
  /** False while the call is still connecting; leaving must stay available. */
  canToggleVideo: boolean;
  /** False when there is no live call to mute into. See call-control-availability. */
  canToggleMic: boolean;
  /** Why the microphone cannot be toggled. Same reasoning as `videoBlockedReason`. */
  micBlockedReason?: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  /** Absent where the browser cannot share a screen; the control is then hidden. */
  onToggleScreenShare?: () => void;
  /**
   * False while somebody ELSE is sharing.
   *
   * One screen at a time, decided here rather than by whoever presses first:
   * two shares would fight over the stage, and the person who loses would not
   * know why their share went nowhere.
   */
  canShareScreen?: boolean;
  /**
   * Why the screen share cannot be used, in words a person can act on.
   *
   * A dimmed control that says nothing is a dead end: the user presses it,
   * nothing happens, and there is nowhere to find out why. Naming the reason
   * turns "broken" into "not yet".
   */
  shareBlockedReason?: string;
  /** Why the camera cannot be toggled. Same reasoning as above. */
  videoBlockedReason?: string;
  /** Opens the video-quality settings. Absent hides the control. */
  onOpenVideoSettings?: () => void;
  onLeave: () => void;
  /** Shown beside the controls; hidden below sm where space is scarce. */
  /**
   * Whether the call clock should be running.
   *
   * This used to take the formatted string, computed by a 1 Hz hook up in
   * `use-direct-call` — which is called from `P2PChat`, so every tick
   * re-rendered the entire conversation, including every message bubble, for
   * the whole duration of every call. Owning the tick here confines it to the
   * one element that displays it.
   */
  running: boolean;
}

/**
 * The in-call control row.
 *
 * Five controls, not fifty. Everything here is something a person reaches for
 * mid-sentence, so each is a single press with no menu in the way.
 */
export function CallControls({
  media,
  canToggleVideo,
  canToggleMic,
  micBlockedReason,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  canShareScreen = false,
  shareBlockedReason,
  videoBlockedReason,
  onOpenVideoSettings,
  onLeave,
  running,
}: CallControlsProps): JSX.Element {
  const duration: string = useCallDuration(running);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="call-controls">
      <ToggleButton
        active={media.audio}
        onClick={onToggleMic}
        disabled={!canToggleMic}
        disabledReason={micBlockedReason}
        testId="call-toggle-mic"
        label="Microphone"
        OnIcon={Mic}
        OffIcon={MicOff}
      />

      <ToggleButton
        active={media.video}
        onClick={onToggleCamera}
        disabled={!canToggleVideo}
        disabledReason={videoBlockedReason}
        testId="call-toggle-camera"
        label="Camera"
        OnIcon={Video}
        OffIcon={VideoOff}
      />

      {onToggleScreenShare && (
        <ToggleButton
          active={media.screen}
          onClick={onToggleScreenShare}
          disabled={!canShareScreen && !media.screen}
          disabledReason={shareBlockedReason}
          testId="call-toggle-screen"
          label="Screen share"
          OnIcon={MonitorX}
          OffIcon={MonitorUp}
          // The one control whose "on" state is not simply the opposite of
          // "off": sharing is a state other people can see, so it is coloured
          // like an alert rather than like a preference.
          activeTone="sharing"
        />
      )}

      {onOpenVideoSettings && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenVideoSettings}
          data-testid="call-video-settings"
          aria-label="Video quality"
          title="Video quality"
          className="tap-target h-10 w-10 rounded-full bg-surface text-foreground hover:bg-surface/80"
        >
          <Gauge className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}

      <span
        className="hidden px-2 text-sm tabular-nums text-muted-foreground sm:inline"
        // Announcing every second would make a screen reader unusable; the
        // duration is reported once when the call ends instead.
        aria-hidden="true"
        data-testid="call-duration"
      >
        {duration}
      </span>

      <Button
        variant="destructive"
        size="sm"
        onClick={onLeave}
        data-testid="call-leave"
        className="ml-1"
      >
        <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Leave
      </Button>
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Why it is unavailable. Its presence is what turns `disabled` into
   * `aria-disabled` -- see the component for why that matters.
   */
  disabledReason?: string;
  testId: string;
  label: string;
  OnIcon: typeof Mic;
  OffIcon: typeof MicOff;
  /**
   * How "on" should look.
   *
   * `default` is the mic and camera: on is neutral, off is the destructive
   * fill that universally means muted. `sharing` inverts that reading -- a
   * screen share being ON is the state worth noticing, because other people can
   * see it, so it is the one that gets the accent.
   */
  activeTone?: 'default' | 'sharing';
}

function ToggleButton({ active, onClick, disabled, disabledReason, testId, label, OnIcon, OffIcon, activeTone = 'default' }: ToggleButtonProps): JSX.Element {
  const Icon: typeof Mic = active ? OnIcon : OffIcon;
  // `disabled` removes the button from the tab order AND stops it firing mouse
  // events, so neither a keyboard user nor a hovering one can ever be told why
  // it will not work. Where there is something to say, the control stays
  // reachable and announces itself as disabled instead -- and the click is
  // suppressed here rather than by the browser.
  const explained: boolean = Boolean(disabled && disabledReason);
  const reasonId: string = useId();
  return (
    <>
    <Button
      variant="ghost"
      size="icon"
      onClick={explained ? undefined : onClick}
      disabled={disabled && !explained}
      aria-disabled={disabled ? true : undefined}
      data-testid={testId}
      // aria-pressed carries the state, so the label must NOT also flip with
      // it. Paired, they contradict: "Mute microphone" + pressed announced as
      // "Mute microphone, pressed", which a listener reads as *muted* -- while
      // the mic was in fact live. On a privacy control that is the worst
      // possible direction to be wrong in. The label now names the thing and
      // the state names the state, which is what aria-pressed is for.
      aria-pressed={active}
      aria-label={label}
      // The reason is a DESCRIPTION, not part of the name. Folding it into the
      // label would make the name change with something other than what
      // `aria-pressed` announces, and a name that moves under a listener is
      // how the mute button came to say the opposite of the truth.
      aria-describedby={explained ? reasonId : undefined}
      // The visible tooltip can still say what the click will DO, because a
      // sighted user reads it alongside the icon rather than as a sentence.
      title={explained ? disabledReason : active ? `${label} on` : `${label} off`}
      className={cn(
        'h-10 w-10 rounded-full transition-colors',
        // Looks disabled without being disabled.
        explained && 'pointer-events-auto cursor-not-allowed opacity-50',
        activeTone === 'sharing'
          ? active
            // Sharing: accented, and ringed so it reads as live at a glance
            // rather than as merely selected.
            ? 'bg-primary text-primary-foreground ring-2 ring-ring/40 hover:bg-primary/90'
            : 'bg-surface text-foreground hover:bg-surface/80'
          : active
            ? 'bg-surface text-foreground hover:bg-surface/80'
            // Destructive fill for "off" is the universal convention for a muted
            // mic, and it survives every workspace theme because it is a token.
            : 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
    {explained && (
      // Off-screen rather than `hidden`: a display:none element is not
      // announced, so the description would resolve to nothing at all.
      <span id={reasonId} className="sr-only">{disabledReason}</span>
    )}
    </>
  );
}
