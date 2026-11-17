/**
 * App zones: every placeholder state, the uniform "not available", a zone name used twice, props
 * that are not what a zone takes, and the runtime seam -- with no runtime nothing is mounted; with
 * one, only an active install's zone is handed to it.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor, fireEvent, type RenderResult } from '@testing-library/react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { AppZone } from '../AppZone';
import { NO_GLUE, NO_TABS } from './doubles/no-tabs';
import { AppZoneContext, zoneClaims, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime, type ZoneHost } from '../app-zone-environment';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import type { Tri } from '@/lib/citadel-apps/scope-options';
import { recordDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { recordPeerConsent } from '@/lib/citadel-apps/peer-for-me';
import { installOf, listingOf } from '@/test/app-manifests';
import type { AppLink } from '@/lib/citadel-apps/app-link';
import { FakeAppsKernel } from '@/test/apps-kernel-fake';
import { zoneDataFrom } from '../zone-data';

const KANBAN: ListedApp = listedApps([listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0' })])[0];

interface World { listing: ListedApp | null; installs: AppInstall[] | null; mayInstall: Tri; runtime: AppZoneRuntime | null }

type TestEnvironment = AppZoneEnvironment & { opened: unknown[]; copied: string[] };

function env(w: Partial<World> = {}): TestEnvironment {
  const world: World = { listing: KANBAN, installs: [], mayInstall: 'yes', runtime: null, ...w };
  const opened: unknown[] = [];
  const copied: string[] = [];
  return {
    opened, copied, nodeId: 'n-2', me: 'alice', ancestors: ['n-1', 'workspace-root'], mayInstall: world.mayInstall, runtime: world.runtime,
    data: {
      listing: async () => (world.listing === null ? { ok: false, refusal: 'Unavailable' } : { ok: true, value: world.listing }),
      installs: async () => (world.installs === null ? { ok: false, refusal: 'ServerFeatureUnavailable' } : { ok: true, value: world.installs }),
      setDisabledForMe: async (_id: string, d: boolean) => ({ ok: true, value: d }),
    },
    openLink: (link: AppLink): void => { opened.push(link); },
    linkUrl: (link: AppLink): string => `https://work.example/workspace?app=${link.appId}`,
    copyText: async (t: string): Promise<void> => { copied.push(t); },
    ...zoneClaims(),
  };
}

const zone = (e: AppZoneEnvironment, props: Record<string, unknown> = {}): ReturnType<typeof render> =>
  render(<AppZoneContext.Provider value={e}><AppZone app="com.acme.kanban" zone="board" height={300} min="1.2.0" {...props} /></AppZoneContext.Provider>);
const state = async (kind: string): Promise<HTMLElement> => waitFor(() => {
  const el: HTMLElement = screen.getByTestId('app-zone-required');
  expect(el.dataset.zoneState).toBe(kind);
  return el;
});

describe('an app zone', () => {
  it('offers Install to someone who may install, opening the marketplace on its link', async () => {
    const e: TestEnvironment = env();
    zone(e);
    expect((await state('install')).textContent).toContain('This zone requires Kanban 1.2+');
    expect(screen.getByTestId('app-icon-image')).toBeTruthy();
    fireEvent.click(screen.getByTestId('app-zone-install'));
    expect(e.opened).toEqual([{ appId: 'com.acme.kanban', nodeId: 'n-2', version: null, server: null }]);
  });

  it('asks an admin when the person may not install, copying the link', async () => {
    const e: TestEnvironment = env({ mayInstall: 'no' });
    zone(e);
    await state('ask-admin');
    fireEvent.click(screen.getByTestId('app-zone-ask-admin'));
    await waitFor(() => expect(e.copied).toEqual(['https://work.example/workspace?app=com.acme.kanban']));
    expect(screen.getByText('Link copied. Send it to a workspace admin.')).toBeTruthy();
  });

  it('a hidden app and a missing one read the same, with no icon of its own', async () => {
    zone(env({ listing: null }));
    const el: HTMLElement = await state('not-available');
    expect(el.textContent).toBe('This zone needs “com.acme.kanban”, which is not available to you.');
    expect(screen.getByTestId('app-icon-generic')).toBeTruthy();
  });

  it('an install covering this page through an ancestor counts; turned off for me offers Turn on', async () => {
    const install: AppInstall = installOf('com.acme.kanban', { NodeTree: 'n-1' });
    recordDisabledForMe(install.id, true);
    zone(env({ installs: [install] }));
    await state('disabled');
    fireEvent.click(screen.getByTestId('app-zone-enable'));
    await state('ready-unmounted');
  });

  it('an install for another page does not cover this one', async () => {
    zone(env({ installs: [installOf('com.acme.kanban', { Node: 'n-9' })] }));
    await state('install');
  });

  it('waiting for consent, suspended, and too old say so', async () => {
    const waiting: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'w', state: { NeedsConsent: { version: '1.5.0', reason: 'CapabilitiesGrew' } } });
    const first: RenderResult = zone(env({ installs: [waiting] }));
    expect((await state('needs-consent')).textContent).toContain('Kanban 1.5.0 needs a new permission; waiting for an admin.');
    first.unmount();
    const old: RenderResult = zone(env({ installs: [installOf('com.acme.kanban', 'Workspace', { id: 'o', version: '1.1.0' })] }));
    expect((await state('outdated')).textContent).toContain('You have 1.1.0.');
    old.unmount();
    zone(env({ installs: [installOf('com.acme.kanban', 'Workspace', { id: 's', state: { Suspended: { reason: 'x' } } })] }));
    await state('suspended');
  });

  it('installed and active, with no runtime, still runs nothing', async () => {
    zone(env({ installs: [installOf('com.acme.kanban', { SelfOnly: 'alice' }, { id: 'a' })] }));
    expect((await state('ready-unmounted')).textContent).toContain('It will run here once apps can run on pages.');
    expect(screen.queryByTestId('app-zone-host')).toBeNull();
  });

  it('with a runtime, an active install is mounted in a host-owned element of the zone’s height, its toolbar slot above it', async () => {
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    zone(env({ installs: [installOf('com.acme.kanban', { SelfOnly: 'alice' }, { id: 'a' })], runtime: { mount, mountPane: NO_TABS, bindGlue: NO_GLUE } }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const [host, mounted] = mount.mock.calls[0] as unknown as [ZoneHost, { zoneId: string; height: number; install: AppInstall }];
    expect(host.canvas.style.height).toBe('300px');
    expect(host.toolbar.nextElementSibling).toBe(host.canvas);
    expect(host.toolbar.style.height).toBe('');
    expect(mounted).toMatchObject({ zoneId: 'board', height: 300, install: { id: 'a' } });
  });

  it('control: with a runtime, a zone the person may only install is not mounted', async () => {
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    zone(env({ runtime: { mount, mountPane: NO_TABS, bindGlue: NO_GLUE } }));
    await state('install');
    expect(mount).not.toHaveBeenCalled();
  });

  it('a second zone of the same name on a page is an inline error, not a second instance', async () => {
    const e: TestEnvironment = env();
    render(
      <AppZoneContext.Provider value={e}>
        <AppZone app="com.acme.kanban" zone="board" height={300} />
        <AppZone app="com.acme.kanban" zone="board" height={300} />
        <AppZone app="com.acme.kanban" zone="other" height={300} />
      </AppZoneContext.Provider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('app-zone-required')).toHaveLength(2));
    expect(screen.getByTestId('app-zone-error').textContent).toContain('already has a zone called “board”');
  });

  it.each([
    ['an app that is not an id', { app: 'Kanban' }],
    ['no zone name', { zone: undefined }],
    ['a height over 2000', { height: 2001 }],
    ['a height that is not a number', { height: '300' }],
    ['a min that is not a version', { min: '1.2' }],
  ])('refuses %s', (_why: string, props: Record<string, unknown>) => {
    zone(env(), props);
    expect(screen.getByTestId('app-zone-error').textContent).toContain('This app zone cannot be shown');
  });

  it('turned off for me is read from the server’s ListInstalls, so a fresh page shows Turn on (control: listed on, it is ready)', async () => {
    const off: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'srv-off' });
    const kernel: FakeAppsKernel = new FakeAppsKernel({ me: 'alice', visible: [listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0' })], hidden: [], installs: [off], permissions: new Set(), disabled: new Set(['srv-off']) });
    const first: RenderResult = zone({ ...env(), data: zoneDataFrom(kernel) });
    await state('disabled');
    first.unmount();
    kernel.world.disabled.clear();
    zone({ ...env(), data: zoneDataFrom(kernel) });
    await state('ready-unmounted');
  });

  it('an app installed from a signed listing (in no registry) is mounted from its release, as the compute-pool spec waits for', async () => {
    const signed: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'signed' });
    const kernel: FakeAppsKernel = new FakeAppsKernel({ me: 'alice', visible: [], hidden: [], installs: [signed], permissions: new Set(), disabled: new Set() });
    kernel.releases.set('signed', listingOf({ id: 'com.acme.kanban', name: 'Kanban', version: '1.4.0' }));
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    zone({ ...env({ runtime: { mount, mountPane: NO_TABS, bindGlue: NO_GLUE } }), data: zoneDataFrom(kernel) });
    const host: HTMLElement = await screen.findByTestId('app-zone-host');
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const [seam, mounted] = mount.mock.calls[0] as unknown as [ZoneHost, { install: AppInstall }];
    expect(seam.canvas).toBe(host);
    expect(mounted.install.id).toBe('signed');
  });

  it('control: an app in no registry with no release reaching this person reads "not available", and nothing is mounted', async () => {
    const signed: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'signed' });
    const kernel: FakeAppsKernel = new FakeAppsKernel({ me: 'alice', visible: [], hidden: [], installs: [signed], permissions: new Set(), disabled: new Set() });
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    zone({ ...env({ runtime: { mount, mountPane: NO_TABS, bindGlue: NO_GLUE } }), data: zoneDataFrom(kernel) });
    await state('not-available');
    expect(screen.queryByTestId('app-zone-host')).toBeNull();
    expect(mount).not.toHaveBeenCalled();
  });

  it('an app granted P2P or topics waits for this member’s own answer, then runs with it (control: answered, it mounts)', async () => {
    // peer-ports.ts reads the member's answer once, as the instance starts: one started before it would never hold what they allow.
    const pool: AppInstall = installOf('com.acme.kanban', 'Workspace', { id: 'asks-first', granted: ['canvas', 'ihttp.p2p.serve', 'group.topic.publish'] });
    const mount: Mock<AppZoneRuntime['mount']> = vi.fn((): AppZoneHandle => ({ close: async (): Promise<void> => undefined }));
    zone(env({ installs: [pool], runtime: { mount, mountPane: NO_TABS, bindGlue: NO_GLUE } }));
    expect((await state('needs-answer')).textContent).toContain('Kanban asks you first');
    expect(mount).not.toHaveBeenCalled();
    act(() => recordPeerConsent('asks-first', { serve: true, call: false, topics: true, at_ms: 1n }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  });

  it('outside a workspace page it says so', () => {
    render(<AppZone app="com.acme.kanban" zone="board" height={300} />);
    expect(screen.getByTestId('app-zone-error').textContent).toContain('only be shown on a workspace page');
  });
});
