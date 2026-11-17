/**
 * What a placed app (a zone in a page, or an app tab) shows and how its running app is closed,
 * shared by AppZone.tsx and AppTabPane.tsx so the two cannot drift: the view decided from the
 * facts (zone-state.ts), the close reason read in the commit that removed or replaced it
 * (zone-close-reason.ts), the wait for open P2P or topic answers, and the placeholder's actions.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { AppLink } from '@/lib/citadel-apps/app-link';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { recordDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { usePeerAnswering } from '@/lib/citadel-apps/peer-answering';
import type { Placement } from '@/lib/citadel-apps/runtime/placement';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import type { AppZoneEnvironment, AppZoneHandle, ZoneHost } from './app-zone-environment';
import { closeReasonFor, type ZoneNext } from './zone-close-reason';
import { zoneView, type ZoneFacts, type ZoneProps, type ZoneView } from './zone-state';
import { useZoneFacts } from './use-zone-facts';

export interface PlaceholderActions {
  onInstall: () => void;
  onEnable: () => void;
  onCopyLink: () => Promise<void>;
  onOpenApps: () => void;
}

export interface PlacedApp {
  facts: ZoneFacts;
  view: ZoneView;
  /** A ready app still waiting for this person's answers: it starts once the panel closes. */
  waiting: boolean;
  /** Why the app that ran `running` closes, as of the commit that removed or replaced it. */
  reasonFor: (running: AppInstall) => CloseReason;
  actions: PlaceholderActions;
}

export function usePlacedApp(props: ZoneProps, env: AppZoneEnvironment, kind: Placement['kind']): PlacedApp {
  const facts: ZoneFacts = useZoneFacts(env, props.app);
  const view: ZoneView = zoneView(props, facts, kind);
  // The view this commit shows and its facts, recorded in the layout phase: before any passive cleanup of the commit.
  const next: React.MutableRefObject<ZoneNext> = useRef<ZoneNext>({ view, facts });
  useLayoutEffect(() => {
    next.current = { view, facts };
  });
  const reasonFor: (running: AppInstall) => CloseReason = useCallback((running: AppInstall): CloseReason => closeReasonFor(running, next.current), []);
  // An app holds the answers it started with (runtime/peer-ports.ts), and each plane is its own
  // write: one started while its member still has the answers open would hold only the first. So
  // it waits for the panel to close -- but only to start: a running app is never stopped for it.
  // Restarting one would leave and rejoin its topics, and the SDK keeps a left group's state, so the
  // rejoin never reopens the channel and every publish after it is refused.
  const answering: ReadonlySet<string> = usePeerAnswering();
  const started: React.MutableRefObject<string | null> = useRef<string | null>(null);
  const waiting: boolean = view.kind === 'ready' && answering.has(view.install.id) && started.current !== view.install.id;
  useLayoutEffect(() => {
    if (view.kind !== 'ready') started.current = null;
    else if (!waiting) started.current = view.install.id;
  });
  const link: AppLink = { appId: props.app, nodeId: env.nodeId, version: null, server: null };
  const enable = async (): Promise<void> => {
    if (view.kind !== 'disabled') return;
    const r: AppsResult<boolean> = await env.data.setDisabledForMe(view.install.id, false);
    if (r.ok) recordDisabledForMe(view.install.id, r.value);
  };
  const actions: PlaceholderActions = {
    onInstall: (): void => env.openLink(link),
    onEnable: (): void => { void enable(); },
    onCopyLink: (): Promise<void> => env.copyText(env.linkUrl(link)),
    onOpenApps: (): void => env.openLink(link),
  };
  return { facts, view, waiting, reasonFor, actions };
}

/**
 * Mounts the running app into the host's two slots and closes it with `reasonFor` when it goes.
 * The previous instance's close is settled first (zone-close.ts): the next one (another release)
 * starts only after it, so it never joins a topic the last one is still leaving.
 */
export function useRuntimeMount(
  running: AppInstall,
  mount: (slots: ZoneHost) => AppZoneHandle,
  reasonFor: (running: AppInstall) => CloseReason,
): { host: React.RefObject<HTMLDivElement>; toolbar: React.RefObject<HTMLDivElement> } {
  const host: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const toolbar: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const closed: React.MutableRefObject<Promise<void>> = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const canvas: HTMLDivElement | null = host.current;
    const bar: HTMLDivElement | null = toolbar.current;
    if (canvas === null || bar === null) return undefined;
    let live: boolean = true;
    let handle: AppZoneHandle | null = null;
    void closed.current.then((): void => {
      if (live) handle = mount({ canvas, toolbar: bar });
    });
    // A passive cleanup: it runs after the commit's layout effects, so the reason is this commit's.
    // close() never rejects (mount-steps.ts reports a failure on a live page). One never mounted
    // (still waiting on the last close) has nothing to close, and the last close is still the wait.
    return (): void => {
      live = false;
      if (handle !== null) closed.current = handle.close(reasonFor(running));
    };
  }, [running, mount, reasonFor]);
  return { host, toolbar };
}
