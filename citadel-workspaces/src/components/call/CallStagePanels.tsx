import { AlertCircle, PhoneOff } from 'lucide-react';
import { callFailureDetail, type CallFailureDetail } from '@/lib/call/call-failure-detail';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { Button } from '@/components/ui/button';
import { useRosterName } from './use-roster-name';
import type { CallParticipant, CallState } from '@/lib/call/call-state';

/**
 * The panels a call stage shows when it is not showing a call.
 *
 * Split out of `CallStage.tsx` when the shared-screen surface pushed that file
 * over its 250-line ceiling. An exact piecewise move: these are the outgoing,
 * connecting and failed states, and none of them knows anything about media.
 */
export function callLabel(call: CallState, others: number): string {
  if (call.status === 'ringing-out') return 'Outgoing call, ringing';
  if (call.status === 'connecting') return 'Call connecting';
  return others === 1 ? 'Call in progress' : `Call in progress with ${others} people`;
}

export function ringingDetail(count: number): string {
  return count === 1 ? 'Waiting for them to answer.' : `Waiting for ${count} people to answer.`;
}

/**
 * Who is being called, not just that a call exists. The halo rings animate
 * only under motion-safe; reduced-motion users get the same layout with a
 * static accent ring, not a slowed-down animation.
 */
export function OutgoingCallPanel({
  invitees,
  onCancel,
}: {
  invitees: CallParticipant[];
  onCancel: () => void;
}): JSX.Element {
  const first: CallParticipant = invitees[0];
  const calleeName: string = useRosterName(first?.cid ?? null, first?.username ?? 'Unknown');
  const title: string =
    invitees.length > 1 ? `Calling ${calleeName} and ${invitees.length - 1} more…` : `Calling ${calleeName}…`;

  return (
    // Polite live region: ringing is information, not a demand.
    <div
      role="status"
      data-testid="call-ringing"
      className="flex flex-col items-center gap-4 rounded-md bg-surface px-4 py-8"
    >
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-2 border-primary-accent motion-safe:animate-ring-pulse"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-2 border-primary-accent motion-safe:animate-ring-pulse motion-safe:[animation-delay:1.2s]"
        />
        <MemberAvatar username={first?.username ?? calleeName} name={calleeName} className="h-16 w-16 text-lg ring-2 ring-primary-accent/70" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{ringingDetail(invitees.length)}</p>
      </div>
      <Button variant="destructive" size="sm" onClick={onCancel} data-testid="call-cancel">
        <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Cancel
      </Button>
    </div>
  );
}

export function ConnectingBanner(): JSX.Element {
  return (
    <div
      role="status"
      data-testid="call-connecting"
      className="mb-2 flex items-center gap-2 rounded-md bg-surface px-3 py-2"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary-accent opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-accent" />
      </span>
      <p className="text-xs text-muted-foreground">Connecting…</p>
    </div>
  );
}

export function ErrorPanel({ title, detail }: { title: string; detail: string }): JSX.Element {
  const shown: CallFailureDetail = callFailureDetail(detail);
  return (
    // Assertive: a failure the user must act on.
    //
    // Which is why what it says has to be addressed to them. `detail` is
    // whatever the media transport threw, and a screen reader reads this out in
    // full: CI caught it announcing a nineteen-digit CID, the word "UdpMode",
    // and a parenthetical aimed at whoever wrote the retry policy.
    //
    // The raw text stays on the element rather than on screen, so support and
    // the specs can still read exactly what the transport said.
    <div
      className="flex items-center gap-3 rounded-md bg-surface p-4"
      role="alert"
      data-testid="call-error"
      data-raw-reason={shown.raw}
      data-reason-recognised={String(shown.recognised)}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{shown.detail}</p>
      </div>
    </div>
  );
}
