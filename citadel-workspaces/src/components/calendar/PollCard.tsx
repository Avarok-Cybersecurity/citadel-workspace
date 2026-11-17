/**
 * One poll on a node (design §3.6.3): each proposed time with who can make it, the member's own
 * yes, maybe or no for each (saved as their vote, poll-draft.ts), and for the poll's host a Pick
 * on each time, which turns the poll into their event with everyone who can make it invited.
 * A picked poll says which time it became.
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PollTally } from '@/lib/calendar/engine/team-engine';
import { formatDayLong } from '@/lib/calendar/format';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { Interval } from '@/lib/calendar/generated/Interval';
import type { Poll } from '@/lib/calendar/generated/Poll';
import type { ProposalTally } from '@/lib/calendar/generated/ProposalTally';
import { repliesOf, voteOf, type Reply } from '@/lib/calendar/poll-draft';
import type { PollVote } from '@/lib/calendar/generated/PollVote';
import { slotName } from './SlotList';

interface PollCardProps {
  poll: Poll;
  me: string;
  engine: CalendarEngine;
  /** The zone times are shown in. */
  zone: string;
  tally: PollTally;
  mine: PollVote | null;
  onVote: (vote: PollVote) => Promise<string | null>;
  onPick: (proposal: number) => Promise<string | null>;
}

const REPLY: Record<Reply, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
const CHOICE: string = 'flex min-h-[44px] min-w-[64px] items-center justify-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

export function PollCard({ poll, me, engine, zone, tally, mine, onVote, onPick }: PollCardProps): JSX.Element {
  const base: string = useId();
  const [replies, setReplies] = useState<Map<number, Reply>>(() => repliesOf(mine, poll.proposals.length));
  const [busy, setBusy] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  useEffect(() => setReplies(repliesOf(mine, poll.proposals.length)), [mine, poll.proposals.length]);
  const open: boolean = poll.state === 'open';
  const hosting: boolean = poll.host === me;
  const when = (s: Interval): string => `${formatDayLong(engine.civilOf(zone, s.start_ms).date)}, ${slotName(s, zone)}`;
  const run = async (what: () => Promise<string | null>, done: string): Promise<void> => {
    setBusy(true);
    const failed: string | null = await what();
    setBusy(false);
    setSaid(failed === null ? done : `Not saved: ${failed}.`);
  };
  const picked: number | null = typeof poll.state === 'object' ? poll.state.picked.proposal : null;

  return (
    <article aria-labelledby={`${base}-title`} className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" data-testid="calendar-poll">
      <h3 id={`${base}-title`} className="text-sm font-semibold text-foreground">{poll.title}</h3>
      <p className="text-sm text-muted-foreground">
        {hosting ? 'Your poll' : `Asked by ${poll.host}`}
        {picked !== null && poll.proposals[picked] !== undefined && ` · Picked: ${when(poll.proposals[picked] as Interval)}`}
        {poll.state === 'closed' && ' · Closed'}
      </p>
      <ol className="flex min-w-0 flex-col gap-3">
        {poll.proposals.map((s: Interval, i: number) => {
          const t: ProposalTally | undefined = tally.tallies[i];
          const reply: Reply = replies.get(i) ?? 'no';
          return (
            <li key={s.start_ms.toString()} className="flex min-w-0 flex-col gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
              <p className="text-sm text-foreground">
                <span className="font-medium">{when(s)}</span>
                {tally.leading === i && <span className="text-muted-foreground"> · Most can make it</span>}
              </p>
              <p className="text-sm text-muted-foreground">{t === undefined ? 'No votes yet' : `${t.yes.length} yes · ${t.maybe.length} maybe`}{t !== undefined && t.yes.length > 0 ? ` (${t.yes.join(', ')})` : ''}</p>
              {open && (
                <fieldset className="flex min-w-0 flex-wrap gap-2">
                  <legend className="sr-only">Can you make {when(s)}?</legend>
                  {(Object.keys(REPLY) as Reply[]).map((r: Reply) => (
                    <label key={r} className={CHOICE}>
                      <input type="radio" name={`${base}-p${i}`} className="sr-only" checked={reply === r} onChange={(): void => setReplies(new Map(replies).set(i, r))} />
                      {REPLY[r]}
                    </label>
                  ))}
                  {hosting && <Button variant="outline" className="h-[44px]" disabled={busy} onClick={(): void => { void run(() => onPick(i), `Picked ${when(s)}; it is on the calendar now.`); }}>Pick this time</Button>}
                </fieldset>
              )}
            </li>
          );
        })}
      </ol>
      {open && <Button className="h-[44px] self-start" disabled={busy} onClick={(): void => { void run(() => onVote(voteOf(poll.id, replies)), 'Your vote is saved.'); }}>Save my vote</Button>}
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </article>
  );
}
