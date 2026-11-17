/**
 * An app tab's panel: the tab analogue of a placed zone (AppZone.tsx), deciding what it shows and
 * how its app is closed through the same hooks (use-placed-app.ts). A ready Citadel App ABI app is
 * mounted through the page's runtime (`mountPane`) in a host that fills the panel and tells the app
 * both of its dimensions; a first-party glue app is its registered component (first-party/
 * registry.ts). Otherwise it draws the zone's placeholder, worded for a tab. Removing a tab never
 * uninstalls anything; switching away unmounts the panel, which closes its app with `unmount`.
 */
import { useCallback, useContext, useEffect, useState, type ComponentType } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { glueTab, mountFor, type GlueTabLoader, type GlueTabProps } from '@/lib/citadel-apps/first-party/registry';
import { usePermission } from '@/hooks/use-permission';
import { permits } from '@/hooks/use-permission-result';
import { Permission } from '@/contexts/PermissionsContext';
import { AppZoneContext, type AppTabMount, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime, type ZoneHost } from './app-zone-environment';
import { useGlueBinding, type GlueBinding } from './use-glue-binding';
import { AppZoneRequired, type PlaceholderView } from './AppZoneRequired';
import type { ZoneProps, ZoneView } from './zone-state';
import { usePlacedApp, useRuntimeMount, type PlacedApp } from './use-placed-app';

/** The placeholder's height in a tab: the panel fills the pane, the placeholder sits at its top. */
const PLACEHOLDER_HEIGHT: number = 240;

interface AppTabPaneProps {
  appId: string;
  /** The tab's name among the node's tabs (`Surface::NodeTab.tab_id`). */
  tabId: string;
}

type Ready = Extract<ZoneView, { kind: 'ready' }>;

interface TabRuntimeHostProps {
  runtime: AppZoneRuntime;
  view: Ready;
  reasonFor: (running: AppInstall) => CloseReason;
  tabId: string;
  nodeId: string;
  me: string;
}

function TabRuntimeHost({ runtime, view, reasonFor, tabId, nodeId, me }: TabRuntimeHostProps): JSX.Element {
  const { install, app } = view;
  const mount: (slots: ZoneHost) => AppZoneHandle = useCallback((slots: ZoneHost): AppZoneHandle =>
    runtime.mountPane(slots, { install, manifest: app.manifest, tabId, nodeId, me }),
  [runtime, install, app.manifest, tabId, nodeId, me]);
  const { host, toolbar } = useRuntimeMount(install, mount, reasonFor);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="app-tab-pane" data-app-id={app.manifest.id}>
      <div ref={toolbar} data-testid="app-tab-toolbar-slot" className="flex-shrink-0 px-[8px]" />
      <div ref={host} data-testid="app-tab-host" className="relative min-h-[320px] w-full flex-1" />
    </div>
  );
}

function GlueTabHost({ runtime, load, tab }: { runtime: AppZoneRuntime; load: GlueTabLoader; tab: AppTabMount }): JSX.Element {
  const binding: GlueBinding = useGlueBinding(runtime, tab);
  const props: Omit<GlueTabProps, 'glue' | 'mayEditNode'> = tab;
  const edit: ReturnType<typeof usePermission> = usePermission(tab.nodeId, Permission.EditMdx);
  const [loaded, setLoaded] = useState<{ Tab: ComponentType<GlueTabProps> } | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live: boolean = true;
    load().then((Tab: ComponentType<GlueTabProps>): void => { if (live) setLoaded({ Tab }); }, (error: unknown): void => {
      console.error(`[apps] ${props.manifest.name}'s tab did not load`, error);
      if (live) setLoaded('failed');
    });
    return (): void => { live = false; };
  }, [load, props.manifest.name]);
  if (binding.kind === 'stopped') return <p role="alert" className="m-[16px] text-sm text-destructive-emphasis">{binding.why}</p>;
  if (loaded === 'loading' || binding.kind === 'binding') return <p role="status" className="m-[16px] text-sm text-muted-foreground">Loading {props.manifest.name}…</p>;
  if (loaded === 'failed') return <p role="alert" className="m-[16px] text-sm text-destructive-emphasis">{props.manifest.name} could not be loaded. Reload the page to try again.</p>;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="app-tab-pane" data-app-id={props.manifest.id}>
      <loaded.Tab {...props} glue={binding.instance} mayEditNode={permits(edit)} />
    </div>
  );
}

function PlacedTab({ appId, tabId, env }: AppTabPaneProps & { env: AppZoneEnvironment }): JSX.Element {
  const props: ZoneProps = { app: appId, zone: tabId, height: PLACEHOLDER_HEIGHT, floor: null };
  const { facts, view, waiting, reasonFor, actions }: PlacedApp = usePlacedApp(props, env, 'tab');
  if (view.kind === 'ready' && !waiting && env.me !== null) {
    const mounts: ReturnType<typeof mountFor> = mountFor(view.app.manifest.sdk.abi);
    if (mounts === 'worker' && env.runtime !== null) {
      return <TabRuntimeHost runtime={env.runtime} view={view} reasonFor={reasonFor} tabId={tabId} nodeId={env.nodeId} me={env.me} />;
    }
    const load: GlueTabLoader | null = mounts === 'glue' ? glueTab(appId) : null;
    if (load !== null && env.runtime !== null) {
      return <GlueTabHost runtime={env.runtime} load={load} tab={{ install: view.install, manifest: view.app.manifest, nodeId: env.nodeId, me: env.me, tabId }} />;
    }
  }
  const shown: PlaceholderView = view.kind !== 'ready' ? view : { kind: waiting ? 'needs-answer' : 'ready-unmounted', name: view.app.manifest.name };
  return (
    <div className="mx-auto w-full max-w-3xl px-[16px] py-[8px]" data-testid="app-tab-pane" data-app-id={appId}>
      <AppZoneRequired
        placement="tab"
        appId={appId}
        floor={null}
        height={PLACEHOLDER_HEIGHT}
        view={shown}
        icon={typeof facts.listing === 'object' ? facts.listing.manifest.icon : null}
        {...actions}
      />
    </div>
  );
}

export function AppTabPane({ appId, tabId }: AppTabPaneProps): JSX.Element {
  const env: AppZoneEnvironment | null = useContext(AppZoneContext);
  if (env === null) {
    return <p role="alert" className="m-[16px] text-sm text-destructive-emphasis">This tab can only be shown on a workspace page.</p>;
  }
  return <PlacedTab appId={appId} tabId={tabId} env={env} />;
}
