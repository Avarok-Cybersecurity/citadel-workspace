/**
 * A node's page when it is an installed app's (node-page-abi.md §3): the page analogue of an app
 * tab (AppTabPane.tsx), deciding what it shows through the same hooks (use-placed-app.ts) but bound
 * to the one install the node names. A ready Citadel App ABI app is mounted through the page's
 * runtime (`mountPage`) in a host that fills the pane and tells the app both of its dimensions,
 * with no editor and no zone frame around it. While it loads, a skeleton of the pane; when it
 * stops, the host's words and a way to try again; otherwise the placeholder, worded for a page.
 */
import { useCallback, useContext, useEffect, useState } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { mountFor } from '@/lib/citadel-apps/first-party/registry';
import type { NodeAppPage } from '@/lib/citadel-apps/node-app-metadata';
import { PAGE_PLACEMENT_ID } from '@/lib/citadel-apps/runtime/placement';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { AppZoneContext, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime, type ZoneHost } from './app-zone-environment';
import { AppZoneRequired, placeholderFor, type PlaceholderView } from './AppZoneRequired';
import type { ZoneProps, ZoneView } from './zone-state';
import { usePlacedApp, useRuntimeMount, type PlacedApp } from './use-placed-app';

/** The placeholder's height on a page: it sits at the top of the pane, as a tab's does. */
const PLACEHOLDER_HEIGHT: number = 240;

type Ready = Extract<ZoneView, { kind: 'ready' }>;
type HostState = 'starting' | 'running' | 'stopped';

/** What the mounted host shows (zone-surface.ts `data-app-state`); text without a state is the runtime that did not load. */
function useHostState(host: React.RefObject<HTMLDivElement>): HostState {
  const [state, setState] = useState<HostState>('starting');
  useEffect(() => {
    const el: HTMLDivElement | null = host.current;
    if (el === null) return undefined;
    const read = (): void => {
      const s: string | undefined = el.dataset.appState;
      setState(s === 'running' || s === 'stopped' ? s : s === undefined && el.textContent !== '' ? 'stopped' : 'starting');
    };
    const watch: MutationObserver = new MutationObserver(read);
    watch.observe(el, { attributes: true, attributeFilter: ['data-app-state'], childList: true, subtree: true, characterData: true });
    read();
    return (): void => watch.disconnect();
  }, [host]);
  return state;
}

function PageSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col gap-[12px] bg-background p-[16px]" aria-hidden="true" data-testid="app-page-skeleton">
      <Skeleton className="h-[24px] w-1/3 motion-reduce:animate-none" />
      <Skeleton className="min-h-0 w-full flex-1 motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

interface PageHostProps {
  runtime: AppZoneRuntime;
  view: Ready;
  reasonFor: (running: AppInstall) => CloseReason;
  nodeId: string;
  me: string;
  onRetry: () => void;
}

function PageRuntimeHost({ runtime, view, reasonFor, nodeId, me, onRetry }: PageHostProps): JSX.Element {
  const { install, app } = view;
  const mount: (slots: ZoneHost) => AppZoneHandle = useCallback((slots: ZoneHost): AppZoneHandle =>
    runtime.mountPage(slots, { install, manifest: app.manifest, nodeId, me }),
  [runtime, install, app.manifest, nodeId, me]);
  const { host, toolbar } = useRuntimeMount(install, mount, reasonFor);
  const state: HostState = useHostState(host);
  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-testid="app-page-pane" data-app-id={app.manifest.id} data-page-state={state}>
      <div ref={toolbar} data-testid="app-page-toolbar-slot" className="flex-shrink-0 px-[8px]" />
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {/* In flow, not absolute: the surface makes its host `position: relative` to place the status over the canvas. */}
        <div ref={host} data-testid="app-page-host" className="h-full w-full" />
        {state === 'starting' && <PageSkeleton label={`Starting ${app.manifest.name}…`} />}
        {state === 'stopped' && (
          <div className="absolute inset-x-0 bottom-[24px] flex justify-center">
            <Button variant="outline" className="min-h-[44px] min-w-[44px]" onClick={onRetry} data-testid="app-page-retry">Try again</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlacedPage({ page, env }: { page: NodeAppPage; env: AppZoneEnvironment }): JSX.Element {
  const props: ZoneProps = { app: page.app, zone: PAGE_PLACEMENT_ID, height: PLACEHOLDER_HEIGHT, floor: null };
  const { facts, view, waiting, reasonFor, actions }: PlacedApp = usePlacedApp(props, env, 'page', page.installId);
  const [attempt, setAttempt] = useState<number>(0);
  if (view.kind === 'loading') {
    return <div className="relative h-full min-h-[320px] w-full" role="status" aria-label="Loading this page’s app"><PageSkeleton label="Loading this page’s app…" /></div>;
  }
  if (view.kind === 'ready' && !waiting && env.me !== null && env.runtime !== null && mountFor(view.app.manifest.sdk.abi) === 'worker') {
    return <PageRuntimeHost key={attempt} runtime={env.runtime} view={view} reasonFor={reasonFor} nodeId={env.nodeId} me={env.me} onRetry={(): void => setAttempt((n: number): number => n + 1)} />;
  }
  // A first-party glue app draws its own tab component and has no page; it is placed here as one that cannot be.
  const shown: PlaceholderView = view.kind !== 'ready' || waiting || env.runtime === null
    ? placeholderFor(view, waiting) : { kind: 'wrong-surface', name: view.app.manifest.name };
  return (
    <div className="mx-auto w-full max-w-3xl px-[16px] py-[8px]" data-testid="app-page-pane" data-app-id={page.app}>
      <AppZoneRequired
        placement="page"
        appId={page.app}
        floor={null}
        height={PLACEHOLDER_HEIGHT}
        view={shown}
        icon={typeof facts.listing === 'object' ? facts.listing.manifest.icon : null}
        {...actions}
      />
    </div>
  );
}

export function AppPagePane({ page }: { page: NodeAppPage }): JSX.Element {
  const env: AppZoneEnvironment | null = useContext(AppZoneContext);
  if (env === null) {
    return <p role="alert" className="m-[16px] text-sm text-destructive-emphasis">This page can only be shown in a workspace.</p>;
  }
  return <PlacedPage page={page} env={env} />;
}
