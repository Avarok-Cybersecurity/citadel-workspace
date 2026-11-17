/**
 * `<AppZone app="com.acme.kanban" zone="board" height={480} />` in a page (registered in
 * mdxComponents.tsx). Its props are the author's and are checked; a zone name already used on the
 * page draws an inline error instead of a second instance. Without a runtime this draws only the
 * placeholder (AppZoneRequired.tsx) and never executes anything; with one (a page passes
 * lazy-runtime.ts), an active install's zone is handed to `runtime.mount` with a host-owned element,
 * and closed with the reason the zone stopped showing it (zone-close-reason.ts). What it shows and
 * how it mounts are shared with app tabs (use-placed-app.ts).
 */
import { useCallback, useContext, useEffect, useId } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { AppZoneContext, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime, type ZoneHost } from './app-zone-environment';
import { AppZoneRequired, type PlaceholderView } from './AppZoneRequired';
import { readZoneProps, type ZoneProps, type ZoneView } from './zone-state';
import { usePlacedApp, useRuntimeMount, type PlacedApp } from './use-placed-app';

interface AppZoneMdxProps {
  app?: unknown;
  zone?: unknown;
  height?: unknown;
  min?: unknown;
}

function ZoneError({ message }: { message: string }): JSX.Element {
  return <p role="alert" className="not-prose my-4 rounded-md border border-destructive/40 p-[12px] text-sm text-destructive-emphasis" data-testid="app-zone-error">{message}</p>;
}

interface RuntimeHostProps {
  runtime: AppZoneRuntime;
  view: Extract<ZoneView, { kind: 'ready' }>;
  reasonFor: (running: AppInstall) => CloseReason;
  props: ZoneProps;
  nodeId: string;
  me: string;
}

function RuntimeHost({ runtime, view, reasonFor, props, nodeId, me }: RuntimeHostProps): JSX.Element {
  const { install, app } = view;
  const mount: (slots: ZoneHost) => AppZoneHandle = useCallback((slots: ZoneHost): AppZoneHandle =>
    runtime.mount(slots, { install, manifest: app.manifest, zoneId: props.zone, nodeId, me, height: props.height }),
  [runtime, install, app.manifest, props.zone, props.height, nodeId, me]);
  const { host, toolbar } = useRuntimeMount(install, mount, reasonFor);
  return (
    <div className="not-prose my-4 w-full">
      <div ref={toolbar} data-testid="app-zone-toolbar-slot" />
      <div ref={host} data-testid="app-zone-host" className="w-full" style={{ height: `${props.height}px` }} />
    </div>
  );
}

function PlacedZone({ props, env }: { props: ZoneProps; env: AppZoneEnvironment }): JSX.Element {
  const { facts, view, waiting, reasonFor, actions }: PlacedApp = usePlacedApp(props, env, 'zone');
  // `ready` is only decided once `me` is known (zone-state.ts).
  if (view.kind === 'ready' && !waiting && env.runtime !== null && env.me !== null) {
    return <RuntimeHost runtime={env.runtime} view={view} reasonFor={reasonFor} props={props} nodeId={env.nodeId} me={env.me} />;
  }
  const shown: PlaceholderView = view.kind !== 'ready' ? view : { kind: waiting ? 'needs-answer' : 'ready-unmounted', name: view.app.manifest.name };
  return (
    <AppZoneRequired
      placement="zone"
      appId={props.app}
      floor={props.floor}
      height={props.height}
      view={shown}
      // The listing's icon only when the listing is visible to this person; the generic one otherwise.
      icon={typeof facts.listing === 'object' ? facts.listing.manifest.icon : null}
      {...actions}
    />
  );
}

export function AppZone({ app, zone, height, min }: AppZoneMdxProps): JSX.Element {
  const env: AppZoneEnvironment | null = useContext(AppZoneContext);
  const token: string = useId();
  const props: ZoneProps | string = readZoneProps(app, zone, height, min);
  const name: string | null = typeof props === 'string' ? null : props.zone;
  const claimed: boolean = env !== null && name !== null && env.claim(name, token);
  useEffect(() => {
    if (env === null || name === null) return undefined;
    // Held again after a remount; a name another zone holds is not ours to release.
    if (!env.claim(name, token)) return undefined;
    return (): void => env.release(name, token);
  }, [env, name, token]);

  if (typeof props === 'string') return <ZoneError message={`This app zone cannot be shown: ${props}.`} />;
  if (env === null) return <ZoneError message="This app zone can only be shown on a workspace page." />;
  if (!claimed) return <ZoneError message={`This page already has a zone called “${props.zone}”; each zone needs its own name.`} />;
  return <PlacedZone props={props} env={env} />;
}
