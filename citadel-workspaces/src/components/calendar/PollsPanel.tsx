/**
 * The polls on this node (design §3.6.3): every member's, each with its tally and the viewer's own
 * vote (polls.ts), and a new poll of the viewer's own. Votes and picks are written to the writer's
 * own namespace; the tally is read from everyone's votes each time, never kept.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readBookingPage } from '@/lib/calendar/booking-pages';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { PollTally } from '@/lib/calendar/engine/team-engine';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { Poll } from '@/lib/calendar/generated/Poll';
import type { PollVote } from '@/lib/calendar/generated/PollVote';
import { castVote, listPolls, pickProposal, readVote, savePoll, tallyOf } from '@/lib/calendar/polls';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { PollCard } from './PollCard';
import { PollComposer } from './PollComposer';

interface PollsPanelProps {
  ports: CalendarPorts;
  engine: CalendarEngine;
  node: { id: string; name: string };
  me: string;
  displayZone: string;
  /** Where a new poll's first time starts, `yyyy-mm-dd`. */
  firstDate: string;
  newId: () => string;
  nowMs: () => bigint;
}

interface Shown { poll: Poll; tally: PollTally; mine: PollVote | null }
type Loaded = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; polls: Shown[]; types: EventType[]; unreadable: number };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');

export function PollsPanel({ ports, engine, node, me, displayZone, firstDate, newId, nowMs }: PollsPanelProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [composing, setComposing] = useState<string | null>(null);
  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const [{ polls, unreadable }, page] = await Promise.all([listPolls(ports, engine, node.id), readBookingPage(ports, engine, node.id, me)]);
      const shown: Shown[] = await Promise.all(polls.map(async (poll: Poll): Promise<Shown> => ({
        poll, tally: await tallyOf(ports, engine, node.id, poll), mine: await readVote(ports, engine, node.id, me, poll.id),
      })));
      setLoaded({ kind: 'ready', polls: shown, types: page.types.filter((t: EventType) => t.kind === 'poll'), unreadable });
    } catch (e: unknown) {
      setLoaded({ kind: 'failed', reason: reasonOf(e) });
    }
  }, [ports, engine, node.id, me]);
  useEffect(() => { void reload(); }, [reload]);
  const saved = async (write: () => Promise<unknown>): Promise<string | null> => {
    try {
      await write();
      await reload();
      return null;
    } catch (e: unknown) {
      return reasonOf(e);
    }
  };

  if (loaded.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading the polls on {node.name}…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">The polls on {node.name} could not be read: {loaded.reason}.</p>;
  return (
    <section aria-label={`Polls on ${node.name}`} className="flex min-w-0 flex-col gap-3" data-testid="calendar-polls">
      <h2 className="text-base font-semibold text-foreground">Polls on {node.name}</h2>
      {loaded.polls.length === 0 && <p className="text-sm text-muted-foreground">No polls yet. Ask people which times suit them, then pick one.</p>}
      {loaded.unreadable > 0 && <p role="status" className="text-sm text-muted-foreground">{loaded.unreadable} {loaded.unreadable === 1 ? 'poll' : 'polls'} could not be read and {loaded.unreadable === 1 ? 'is' : 'are'} not shown.</p>}
      {loaded.polls.map(({ poll, tally, mine }: Shown) => (
        <PollCard key={`${poll.host}/${poll.id}`} poll={poll} me={me} engine={engine} zone={displayZone} tally={tally} mine={mine}
          onVote={(vote: PollVote): Promise<string | null> => saved(() => castVote(ports, engine, node.id, me, poll, vote))}
          onPick={(proposal: number): Promise<string | null> => saved(() => pickProposal(ports, engine, poll, proposal, { node: node.id, eventId: newId(), nowMs: nowMs() }))} />
      ))}
      {composing !== null ? (
        <PollComposer key={composing} id={composing} me={me} zone={displayZone} engine={engine} types={loaded.types} firstDate={firstDate}
          onSave={(poll: Poll): Promise<string | null> => saved(() => savePoll(ports, engine, node.id, poll))} onCancel={(): void => setComposing(null)} />
      ) : (
        <Button variant="outline" className="h-[44px] self-start" onClick={(): void => setComposing(newId())}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>New poll</span>
        </Button>
      )}
    </section>
  );
}
