/**
 * The page's runtime is loaded with the first zone that has an app to run, once, and never for a
 * page whose zones only show placeholders; a zone unmounted while it loads mounts nothing, and a
 * load that failed is tried again by the next zone.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { AppZone } from '../AppZone';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment, type AppZoneHandle, type AppZoneMount, type AppZoneRuntime, type ZoneHost } from '../app-zone-environment';
import { lazyRuntime } from '../lazy-runtime';
import { NO_GLUE, NO_TABS } from './doubles/no-tabs';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { installOf, listingOf } from '@/test/app-manifests';

const KANBAN: ListedApp = listedApps([listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0' })])[0];

function env(installs: AppInstall[], runtime: AppZoneRuntime): AppZoneEnvironment {
  return {
    nodeId: 'n-2', me: 'alice', ancestors: [], mayInstall: 'yes', runtime,
    data: { listing: async () => ({ ok: true, value: KANBAN }), installs: async () => ({ ok: true, value: installs }), setDisabledForMe: async (_i: string, d: boolean) => ({ ok: true, value: d }) },
    openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };
}

const zone = (e: AppZoneEnvironment): ReturnType<typeof render> =>
  render(<AppZoneContext.Provider value={e}><AppZone app="com.acme.kanban" zone="board" height={300} /></AppZoneContext.Provider>);

const slots = (): ZoneHost => ({ canvas: document.createElement('div'), toolbar: document.createElement('div') });

describe('the lazily loaded runtime', () => {
  it('is not loaded for a zone whose app is not installed (control: installed, it is loaded and mounts the zone, with who it acts for)', async () => {
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    const load: Mock<() => Promise<AppZoneRuntime>> = vi.fn(async () => ({ mount, mountPane: NO_TABS, bindGlue: NO_GLUE }));
    const idle: ReturnType<typeof render> = zone(env([], lazyRuntime(load)));
    await waitFor(() => expect(screen.getByTestId('app-zone-required').dataset.zoneState).toBe('install'));
    expect(load).not.toHaveBeenCalled();
    idle.unmount();

    zone(env([installOf('com.acme.kanban', 'Workspace')], lazyRuntime(load)));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect((mount.mock.calls[0] as unknown as [ZoneHost, AppZoneMount])[1]).toMatchObject({ zoneId: 'board', me: 'alice', height: 300 });
  });

  it('loads once for many zones, and a zone gone before it loaded mounts nothing', async () => {
    let finish: (r: AppZoneRuntime) => void = () => undefined;
    const load: Mock<() => Promise<AppZoneRuntime>> = vi.fn(() => new Promise<AppZoneRuntime>((r) => { finish = r; }));
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    const runtime: AppZoneRuntime = lazyRuntime(load);
    const first: AppZoneHandle = runtime.mount(slots(), {} as AppZoneMount);
    runtime.mount(slots(), {} as AppZoneMount);
    await first.close('unmount');
    finish({ mount, mountPane: NO_TABS, bindGlue: NO_GLUE });
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a load that failed says so in the zone and is tried again by the next zone', async () => {
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    const load: Mock<() => Promise<AppZoneRuntime>> = vi.fn()
      .mockRejectedValueOnce(new Error('chunk gone'))
      .mockResolvedValueOnce({ mount, mountPane: NO_TABS, bindGlue: NO_GLUE });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime: AppZoneRuntime = lazyRuntime(load);
    const first: ZoneHost = slots();
    runtime.mount(first, {} as AppZoneMount);
    await waitFor(() => expect(first.canvas.textContent).toBe('This app could not be loaded. Reload the page to try again.'));
    runtime.mount(slots(), {} as AppZoneMount);
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});
