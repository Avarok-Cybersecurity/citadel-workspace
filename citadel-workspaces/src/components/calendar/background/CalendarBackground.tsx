/**
 * The Calendar's background work for the signed-in member (lib/calendar/calendar-background.ts),
 * in the one window that holds their runner lock: mounted by every workspace window's layout,
 * whether or not any of them shows the Calendar. A window that waits its turn binds nothing. It is
 * also the one window that lists the reminders the agent fires (page-agent-reminders.ts).
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { startCalendarBackground } from '@/lib/calendar/calendar-background';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { CalendarPorts } from '@/lib/calendar/ports';
import { pageAgentReminders } from '@/lib/calendar/page-agent-reminders';
import { browserRunnerLock, runnerLockName, type RunnerLock } from '@/lib/calendar/runner-lock';
import { useHeldLock } from './use-held-lock';
import { WithCalendar, type CalendarReach } from './WithCalendar';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

function Running({ ports, engine, me, name }: { ports: CalendarPorts; engine: CalendarEngine; me: string; name: string }): null {
  const { state } = useWorkspace();
  const nodes: MutableRefObject<Record<string, DomainNode>> = useRef(state.nodes);
  nodes.current = state.nodes;
  useEffect(() => startCalendarBackground({
    ports, engine, me,
    nodeName: (id: string): string => nodes.current[id]?.name ?? 'a page you cannot see',
    deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    report: (what: string, error: unknown): void => console.error(what, error),
    agent: pageAgentReminders(name),
  }), [ports, engine, me, name]);
  return null;
}

export function CalendarBackground({ lock }: { lock: RunnerLock }): JSX.Element | null {
  const { state } = useWorkspace();
  const me: string | null = state.currentUser?.username ?? null;
  const held: boolean = useHeldLock(lock, me === null ? null : runnerLockName(me));
  if (me === null || !held) return null;
  return (
    <WithCalendar me={me} purpose="background">
      {(reach: CalendarReach) => (reach.kind === 'ready' ? <Running ports={reach.ports} engine={reach.engine} me={me} name={reach.name} /> : null)}
    </WithCalendar>
  );
}

/** The page's: the browser's Web Locks. */
export default function PageCalendarBackground(): JSX.Element | null {
  const lock: RunnerLock = useMemo(browserRunnerLock, []);
  return <CalendarBackground lock={lock} />;
}
