/**
 * A node bound to an installed app's page (node-page-abi.md §3) hands the install it names to the
 * page runtime's `mountPage` (never `mount` or `mountPane`), and says what happened instead when
 * it cannot: loading (a skeleton of the pane), the install gone (ask an admin to install it), a
 * release that no longer offers `node_page` (it can no longer be a page), and an app that stopped
 * (the host's words and Try again, which mounts it afresh).
 *
 * Real: AppPagePane, use-placed-app.ts, the zone state and the placeholder. Doubles: the runtime
 * (the seam, recording what it is asked; the real one needs a worker and a kernel, and runtime-rig
 * tests run it) and the zone's data port (the kernel's answers, as values).
 *
 * Negative controls (each applied, seen red, reverted): passing `null` instead of the node's
 * install to usePlacedApp fails "mounts the install the node names" and "the install it names is
 * gone"; the 'page' placement reporting `node_tab` as its surface fails "no longer"; a constant key
 * on the mounted host (no remount) fails "Try again".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall } from 'citadel-workspace-client-ts';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import type { CloseReason } from '@/lib/citadel-apps/sdk/generated/CloseReason';
import { installOf, listingOf } from '@/test/app-manifests';
import { AppZoneContext, zoneClaims, type AppPageMount, type AppZoneEnvironment, type AppZoneHandle, type AppZoneRuntime, type ZoneHost } from '../app-zone-environment';
import { AppPagePane } from '../AppPagePane';
import { NO_GLUE, NO_TABS, ANSWER_TAKEN } from './doubles/no-tabs';
import type { Tri } from '@/lib/citadel-apps/scope-options';

const APP: string = 'work.synchronized.app';
const listed = (surfaces: ('node_page' | 'node_tab')[]): ListedApp => listedApps([listingOf({ id: APP, name: 'Synchronized', version: '1.4.0', surfaces, scopes: ['workspace'] })])[0];
const AS_PAGE: ListedApp = listed(['node_page', 'node_tab']);
const BOUND: AppInstall = installOf(APP, 'Workspace', { id: 'inst-bound' });
const OTHER: AppInstall = installOf(APP, 'Workspace', { id: 'inst-other' });

interface Recording { pages: AppPageMount[]; closes: CloseReason[]; stopNext: boolean }

function recordingRuntime(rec: Recording): AppZoneRuntime {
  return {
    mount: (): AppZoneHandle => { throw new Error('a page mounts no zone'); },
    mountPane: NO_TABS,
    bindGlue: NO_GLUE,
    mountPage: (slots: ZoneHost, page: AppPageMount): AppZoneHandle => {
      rec.pages.push(page);
      // What zone-surface.ts leaves on the host: a state, and the host's words when it stopped.
      slots.canvas.dataset.appState = rec.stopNext ? 'stopped' : 'running';
      if (rec.stopNext) slots.canvas.textContent = 'Synchronized stopped because of an error.';
      rec.stopNext = false;
      return { close: async (reason: CloseReason): Promise<void> => { rec.closes.push(reason); } };
    },
  };
}

function env(runtime: AppZoneRuntime, listing: ListedApp | 'pending', installs: AppInstall[], mayInstall: Tri = 'no'): AppZoneEnvironment {
  const never: Promise<never> = new Promise<never>(() => undefined);
  return {
    nodeId: 'n1', me: 'alice', ancestors: [], mayInstall, runtime,
    data: {
      listing: () => (listing === 'pending' ? never : Promise.resolve({ ok: true, value: listing })),
      installs: async () => ({ ok: true, value: installs }),
      setDisabledForMe: async (_i: string, d: boolean) => ({ ok: true, value: d }), setPeerConsentForMe: ANSWER_TAKEN,
    },
    // Nothing here presses "Try again": the data never fails to load.
    reload: (): void => undefined,
    openLink: () => undefined, linkUrl: () => '', copyText: async () => undefined, ...zoneClaims(),
  };
}

const show = (zoneEnv: AppZoneEnvironment): void => {
  render(<AppZoneContext.Provider value={zoneEnv}><AppPagePane page={{ app: APP, installId: BOUND.id }} /></AppZoneContext.Provider>);
};
const fresh = (): Recording => ({ pages: [], closes: [], stopNext: false });

describe('an installed app’s page', () => {
  beforeEach((): void => { cleanup(); });

  it('mounts the install the node names as the page, not another install of the same app', async () => {
    const rec: Recording = fresh();
    show(env(recordingRuntime(rec), AS_PAGE, [OTHER, BOUND]));
    await waitFor(() => expect(rec.pages).toHaveLength(1));
    expect(rec.pages[0]).toMatchObject({ install: { id: 'inst-bound' }, nodeId: 'n1', me: 'alice', manifest: { id: APP } });
    await waitFor(() => expect(screen.getByTestId('app-page-pane').dataset.pageState).toBe('running'));
    expect(screen.queryByTestId('app-zone-required')).toBeNull();
    expect(screen.queryByTestId('app-page-skeleton')).toBeNull();
  });

  it('shows a skeleton of the pane, not a blank, while its app is looked up', () => {
    show(env(recordingRuntime(fresh()), 'pending', [BOUND]));
    expect(screen.getByRole('status', { name: 'Loading this page’s app' })).toBeTruthy();
    expect(screen.getByTestId('app-page-skeleton')).toBeTruthy();
  });

  it('when the install it names is gone, asks for an admin and mounts nothing', async () => {
    const rec: Recording = fresh();
    show(env(recordingRuntime(rec), AS_PAGE, [OTHER]));
    await waitFor(() => expect(screen.getByTestId('app-zone-required').dataset.zoneState).toBe('ask-admin'));
    expect(screen.getByRole('group', { name: 'App page' }).textContent).toContain('This page requires Synchronized');
    expect(screen.getByRole('button', { name: 'Copy link for an admin' })).toBeTruthy();
    expect(rec.pages).toEqual([]);
  });

  it('when its release no longer offers a page, says it can no longer be one and mounts nothing', async () => {
    const rec: Recording = fresh();
    show(env(recordingRuntime(rec), listed(['node_tab']), [BOUND]));
    await waitFor(() => expect(screen.getByTestId('app-zone-required').dataset.zoneState).toBe('wrong-surface'));
    expect(screen.getByTestId('app-zone-required').textContent).toContain('Synchronized can no longer be shown as a page.');
    expect(rec.pages).toEqual([]);
  });

  it('when its app stops, keeps the host’s words and offers Try again, which mounts it afresh', async () => {
    const rec: Recording = { ...fresh(), stopNext: true };
    show(env(recordingRuntime(rec), AS_PAGE, [BOUND]));
    const retry: HTMLElement = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByTestId('app-page-host').textContent).toBe('Synchronized stopped because of an error.');
    await userEvent.click(retry);
    await waitFor(() => expect(rec.pages).toHaveLength(2));
    expect(rec.closes).toEqual(['unmount']);
    await waitFor(() => expect(screen.getByTestId('app-page-pane').dataset.pageState).toBe('running'));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
