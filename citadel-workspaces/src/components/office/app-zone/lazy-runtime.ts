/**
 * The runtime a page's zones and app tabs mount through: the real sandbox host (citadel-apps/
 * runtime/page-runtime.ts), loaded the first time one has an app to run and never before, so a
 * page without one, and the landing page, carry none of it. One closed while the host loads
 * mounts nothing.
 */
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import type { AppTabMount, AppZoneHandle, AppZoneMount, AppZoneRuntime, GlueBound, GlueHandle, GlueTabMount, ZoneHost } from './app-zone-environment';

type Loader = () => Promise<AppZoneRuntime>;

export function lazyRuntime(load: Loader): AppZoneRuntime {
  let loading: Promise<AppZoneRuntime> | null = null;
  const later = (host: ZoneHost, mount: (runtime: AppZoneRuntime) => AppZoneHandle): AppZoneHandle => {
    let mounted: AppZoneHandle | null = null;
    let live: boolean = true;
    loading ??= load();
    loading.then((runtime: AppZoneRuntime): void => {
      if (live) mounted = mount(runtime);
    }, (error: unknown): void => {
      // A chunk that failed to load is retried by the next mount.
      loading = null;
      if (live) host.canvas.textContent = 'This app could not be loaded. Reload the page to try again.';
      console.error('[apps] the app runtime did not load', error);
    });
    return {
      close: (reason: CloseReason): Promise<void> => {
        live = false;
        return mounted === null ? Promise.resolve() : mounted.close(reason);
      },
    };
  };
  const bindLater = (tab: GlueTabMount): GlueHandle => {
    let bound: GlueHandle | null = null;
    let live: boolean = true;
    loading ??= load();
    const ready: Promise<GlueBound> = loading.then((runtime: AppZoneRuntime): Promise<GlueBound> | GlueBound => {
      if (!live) return { kind: 'stopped', why: `${tab.manifest.name} was closed before it started.` };
      bound = runtime.bindGlue(tab);
      return bound.ready;
    }, (error: unknown): GlueBound => {
      loading = null;
      console.error('[apps] the app runtime did not load', error);
      return { kind: 'stopped', why: 'This app could not be loaded. Reload the page to try again.' };
    });
    return {
      ready,
      close: async (): Promise<void> => {
        live = false;
        await ready;
        await bound?.close();
      },
    };
  };
  return {
    bindGlue: bindLater,
    mount: (host: ZoneHost, zone: AppZoneMount): AppZoneHandle => later(host, (runtime: AppZoneRuntime): AppZoneHandle => runtime.mount(host, zone)),
    mountPane: (host: ZoneHost, tab: AppTabMount): AppZoneHandle => later(host, (runtime: AppZoneRuntime): AppZoneHandle => runtime.mountPane(host, tab)),
  };
}

export const pageZoneRuntime: AppZoneRuntime = lazyRuntime(() => import('@/lib/citadel-apps/runtime/page-runtime').then((m) => m.pageAppZoneRuntime));
