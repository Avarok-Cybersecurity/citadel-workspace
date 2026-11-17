/**
 * The Calendar's ports outside its tab: the workspace's Calendar install that reaches this member,
 * decided exactly as a tab decides it (use-placed-app.ts over the page's apps data), bound through
 * the page's runtime as a glue tab is (use-glue-binding.ts), with its core loaded, and its notices
 * under the member's settings (notice-gate.ts). Used by the background work and by the settings a
 * member reaches from the workspace's own Settings; each binding takes one of the page's instance
 * slots for as long as it is mounted.
 *
 * The binding is not a tab: `bindGlue` reads only the install and the manifest, so `tabId` names
 * what is bound and `nodeId` is the workspace's root, where a workspace-wide install reaches.
 */
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppZonePage } from '@/components/office/app-zone/AppZonePage';
import { AppZoneContext, type AppTabMount, type AppZoneEnvironment, type AppZoneRuntime } from '@/components/office/app-zone/app-zone-environment';
import { pageZoneRuntime } from '@/components/office/app-zone/lazy-runtime';
import { useGlueBinding, type GlueBinding } from '@/components/office/app-zone/use-glue-binding';
import { usePlacedApp, type PlacedApp } from '@/components/office/app-zone/use-placed-app';
import { recordAppNoticeDelivery } from '@/lib/citadel-apps/app-notice-delivery';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { intlOffsetAt } from '@/lib/calendar/engine/intl-offsets';
import { loadCalendarWasm } from '@/lib/calendar/engine/load-calendar-wasm';
import { withNoticePrefs } from '@/lib/calendar/notice-gate';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

export type CalendarReach =
  | { readonly kind: 'waiting' }
  /** No Calendar reaches this member here, or it cannot start: `why` says which, for a member to read. */
  | { readonly kind: 'absent'; readonly why: string }
  | { readonly kind: 'ready'; readonly ports: CalendarPorts; readonly engine: CalendarEngine };

interface WithCalendarProps {
  me: string;
  /** What is bound, for the instance's name: 'background' or 'settings'. */
  purpose: string;
  children: (reach: CalendarReach) => ReactNode;
}

const recordDelivery = (system: boolean): void => recordAppNoticeDelivery(CALENDAR_APP_ID, system);

function Bound({ runtime, tab, children }: { runtime: AppZoneRuntime; tab: AppTabMount; children: WithCalendarProps['children'] }): JSX.Element {
  const binding: GlueBinding = useGlueBinding(runtime, tab);
  const [engine, setEngine] = useState<CalendarEngine | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live: boolean = true;
    loadCalendarWasm().then((g) => { if (live) setEngine(new CalendarEngine(g, intlOffsetAt())); }, (error: unknown): void => {
      console.error('[calendar] the core did not load', error);
      if (live) setEngine('failed');
    });
    return (): void => { live = false; };
  }, []);
  const ports: CalendarPorts | null = useMemo(() => (binding.kind === 'bound' ? withNoticePrefs(calendarPorts(binding.instance), recordDelivery) : null), [binding]);
  if (binding.kind === 'stopped') return <>{children({ kind: 'absent', why: binding.why })}</>;
  if (engine === 'failed') return <>{children({ kind: 'absent', why: 'The Calendar could not be loaded. Reload the page to try again.' })}</>;
  if (ports === null || engine === 'loading') return <>{children({ kind: 'waiting' })}</>;
  return <>{children({ kind: 'ready', ports, engine })}</>;
}

function Placed({ me, purpose, children }: WithCalendarProps): JSX.Element {
  const env: AppZoneEnvironment | null = useContext(AppZoneContext);
  if (env === null) throw new Error('WithCalendar renders its own zone environment');
  const { view, waiting }: PlacedApp = usePlacedApp({ app: CALENDAR_APP_ID, zone: purpose, height: 0, floor: null }, env, 'tab');
  if (view.kind === 'loading' || waiting) return <>{children({ kind: 'waiting' })}</>;
  if (view.kind !== 'ready') return <>{children({ kind: 'absent', why: 'The Calendar is not available to you in this workspace.' })}</>;
  if (env.runtime === null) return <>{children({ kind: 'absent', why: 'Apps cannot run on this page.' })}</>;
  return <Bound runtime={env.runtime} tab={{ install: view.install, manifest: view.app.manifest, tabId: purpose, nodeId: WORKSPACE_ROOT_ID, me }}>{children}</Bound>;
}

export function WithCalendar(props: WithCalendarProps): JSX.Element {
  return (
    <AppZonePage nodeId={WORKSPACE_ROOT_ID} runtime={pageZoneRuntime}>
      <Placed {...props} />
    </AppZonePage>
  );
}
