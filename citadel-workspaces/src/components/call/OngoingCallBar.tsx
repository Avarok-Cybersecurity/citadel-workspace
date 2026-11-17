import { stillInCall, hasAnswered } from '@/lib/call/participant-presence';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';
import { PhoneOff, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCall } from '@/lib/call/call-context';
import { useCallStageVisible } from './call-stage-presence';
import { useCallDuration } from './use-call-duration';
import { useRosterName } from './use-roster-name';
import { openCallHome } from './open-call-home';
import type { CallParticipant } from '@/lib/call/call-state';

/**
 * "You are in a call" — shown when the call's own surface is not on screen.
 *
 * Without this, navigating away from a call's conversation left no indication
 * anywhere that the call was still running, and no way to end it: the only
 * hang-up control lives on the stage that just unmounted. A user could walk
 * away from a live microphone believing the call had ended with the page.
 */
export function OngoingCallBar(): JSX.Element | null {
  const { call, leave } = useCall();
  const stageVisible: boolean = useCallStageVisible();
  const navigate: GuardedNavigate = useGuardedNavigate();
  const duration: string = useCallDuration(call?.status === 'active');
  const others: CallParticipant[] = call ? [...call.participants.values()].filter(stillInCall) : [];
  const onlyOther: string = useRosterName(others.length === 1 ? others[0].cid : null, others[0]?.username ?? '');

  if (!call) return null;
  if (stageVisible) return null;
  // Ringing has its own card; this is for calls that are already running.
  if (call.status !== 'active' && call.status !== 'connecting') return null;

  // `participants` holds the other side only — self is rendered separately by
  // the stage. Filtered the same way the stage filters, so the count the bar
  // reports and the tiles the user would see on Return agree.
  const who: string = others.length === 1 ? onlyOther : `${others.length} people`;

  // "In call with alice" was said while alice's phone was still ringing.
  // `stillInCall` is the right filter for "do not tear this down yet" and the
  // wrong one for a claim about who is on the call: `invited` means rung, and
  // that person may never pick up.
  const anyoneAnswered: boolean = others.some(hasAnswered);

  // Guarded: Return leaves the page an unsaved document may be open on (#102).
  const returnToCall = (): void => openCallHome(call.home, others[0], (to: string): void => { void navigate(to); });

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg"
    >
      <Radio className="h-4 w-4 shrink-0 text-primary-accent" aria-hidden="true" />
      <span className="min-w-0 truncate text-sm">
        {anyoneAnswered ? 'In call with' : 'Calling'} {who}
        <span
          className="ml-2 tabular-nums text-muted-foreground"
          // Inside a polite live region that re-announces on every content
          // change, and this changes once a second. A screen-reader user
          // navigating anywhere else in the app heard "In call with Ana 00:41,
          // 00:42, 00:43" for the whole call -- the rest of the product became
          // unusable exactly while the mic was hot. CallControls hides its copy
          // of the same value for the same reason; the fix stopped there.
          aria-hidden="true"
        >
          {duration}
        </span>
      </span>
      <Button size="sm" variant="secondary" onClick={returnToCall}>
        Return
      </Button>
      <Button
        size="sm"
        variant="destructive"
        aria-label="Leave call"
        onClick={() => void leave()}
      >
        <PhoneOff className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
