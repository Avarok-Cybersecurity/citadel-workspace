/**
 * Keeps the store's sources read (design 3.3.1, 3.5): each once when the pane mounts, and again
 * whenever a change touches it (change-routing.ts), whether the kernel said so (`StorageChanged`)
 * or another window did on the `cal` topic. The node's own events, what members posted, the
 * member's private events, what ancestors project here, and what the pages below pull up; the
 * last two need the tree around the node, walked once per mount (tree-walk.ts).
 *
 * Two reads of one source can be in flight at once (a change arriving mid-read); only the newest
 * one's answer is kept, so an older, slower read cannot overwrite a newer one.
 */
import { useEffect } from 'react';
import type { StorageChange, Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';
import { listenCal } from './cal-topic';
import { sourcesOfStorageChange, sourcesOfTopicChange, type Around } from './change-routing';
import type { CalendarEngine } from './engine/calendar-engine';
import type { CalChange } from './generated/CalChange';
import { PortRefused, refusalCopy, type CalendarPorts } from './ports';
import { readInherited, readUpPulled, type PropagatedRead } from './read-propagated';
import { readSource } from './read-sources';
import type { CalendarAction, CalendarEntry, EntrySource } from './store';
import { chainOf, descendantsOf } from './tree-walk';

const SOURCES: readonly EntrySource[] = ['node', 'authored', 'private', 'inherited', 'up_pulled'];

interface Got {
  readonly entries: CalendarEntry[];
  readonly unreadable: number;
  readonly limitedTo: number | null;
}

function reasonOf(error: unknown): string {
  if (error instanceof PortRefused) return refusalCopy(error.refused);
  return 'something went wrong reading it';
}

async function aroundOf(ports: CalendarPorts, engine: CalendarEngine, node: string): Promise<Around> {
  const [chain, below] = await Promise.all([chainOf(ports, node), descendantsOf(ports, node, engine.propagationBounds().up_pull)]);
  return { node, chain, below: new Set(below) };
}

async function readOne(ports: CalendarPorts, engine: CalendarEngine, source: EntrySource, node: string, around: Promise<Around>): Promise<Got> {
  if (source === 'inherited') return { ...(await readInherited(ports, engine, node)), limitedTo: null };
  if (source === 'up_pulled') {
    const { chain, below } = await around;
    const got: PropagatedRead = await readUpPulled(ports, engine, chain, [...below]);
    return { entries: got.entries, unreadable: got.unreadable, limitedTo: got.truncated ? engine.propagationBounds().up_pull : null };
  }
  return { ...(await readSource(ports, engine, source, node)), limitedTo: null };
}

export function useCalendarSources(ports: CalendarPorts, engine: CalendarEngine, node: string, dispatch: (action: CalendarAction) => void): void {
  useEffect(() => {
    let live: boolean = true;
    const around: Promise<Around> = aroundOf(ports, engine, node);
    const latest: Map<EntrySource, number> = new Map();
    const read = async (source: EntrySource): Promise<void> => {
      const turn: number = (latest.get(source) ?? 0) + 1;
      latest.set(source, turn);
      dispatch({ type: 'loading', source });
      try {
        const got: Got = await readOne(ports, engine, source, node, around);
        if (live && latest.get(source) === turn) dispatch({ type: 'read', source, entries: got.entries, unreadable: got.unreadable, limitedTo: got.limitedTo });
      } catch (error: unknown) {
        if (!(error instanceof PortRefused)) console.error(`[calendar] reading ${source} failed`, error);
        if (live && latest.get(source) === turn) dispatch({ type: 'failed', source, reason: reasonOf(error) });
      }
    };
    const reread = (sources: readonly EntrySource[]): void => {
      if (live) for (const source of sources) void read(source);
    };
    for (const source of SOURCES) void read(source);
    // A walk of the tree that failed leaves only this node's own keys routable; up_pulled says it failed.
    const route = (pick: (a: Around) => EntrySource[]): void => {
      void around.then((a: Around) => reread(pick(a)), (): void => reread(pick({ node, chain: [node], below: new Set() })));
    };
    const offStorage: Unsubscribe = ports.onStorageChanged((change: StorageChange): void => route((a: Around) => sourcesOfStorageChange(change, a)));
    const offTopic: () => void = listenCal(ports, engine, (change: CalChange): void => route((a: Around) => sourcesOfTopicChange(change, a)));
    return (): void => {
      live = false;
      offStorage();
      offTopic();
    };
  }, [ports, engine, node, dispatch]);
}
