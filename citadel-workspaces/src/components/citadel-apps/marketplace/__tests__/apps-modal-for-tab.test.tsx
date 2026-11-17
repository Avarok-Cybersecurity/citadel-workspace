/**
 * The marketplace opened from a node's "+": only the apps that can be a tab there, under a heading
 * naming the page; one installed here is added at once, one that is not is installed (starting at
 * "this page and the pages below it") and then added; a refused add leaves the list open.
 *
 * Real: AppsModal, AppsBrowse, AppFlow and the install flow over the contract fake of the kernel.
 * The target's `add` stands in for the node pane's own write (use-node-tabs.ts, tested with it).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppListing } from 'citadel-workspace-client-ts';
import type { TabTarget } from '@/lib/citadel-apps/apps-modal-store';
import { CONSENT_VISIBLE_MS } from '@/lib/citadel-apps/consent-gate';
import { cap, installOf, listingOf } from '@/test/app-manifests';
import { AppsModal } from '../AppsModal';
import { catalogueText, harness, viewerHolding, type Harness } from './marketplace-harness';

// Only `canvas`, which needs no further permission: these tests are about the tab, not the consent.
const CALENDAR: AppListing = listingOf({ id: 'net.avarok.calendar', name: 'Calendar', categories: ['planning'], surfaces: ['node_tab'], capabilities: [cap('canvas')] });
const CALENDAR_HERE: AppListing = listingOf({ id: 'net.avarok.calendar', name: 'Calendar', categories: ['planning'], surfaces: ['node_tab'], capabilities: [cap('canvas')] }, 'workspace');
const KANBAN: AppListing = listingOf({ id: 'com.acme.kanban', name: 'Kanban', categories: ['productivity'], surfaces: ['md_zone', 'node_tab'] });
const ZONE_ONLY: AppListing = listingOf({ id: 'com.acme.chart', name: 'Chart', surfaces: ['md_zone'] });
const MAY: ReadonlySet<string> = new Set(['AppInstall', 'AppInstallScoped', 'UpdateNodeSettings']);

interface Recorded { target: TabTarget; added: string[]; closed: boolean[] }

function openForTab(h: Harness, answer: boolean, tabs: readonly string[] = []): Recorded {
  const added: string[] = [];
  const closed: boolean[] = [];
  const target: TabTarget = { nodeId: 'n-1', tabs, add: async (appId: string): Promise<boolean> => { added.push(appId); return answer; } };
  render(<AppsModal open onOpenChange={(open: boolean): void => { closed.push(!open); }} request={{ kind: 'tab', target }} deps={h.deps} viewer={viewerHolding(MAY)} />);
  return { target, added, closed };
}
const names = (): string[] => screen.queryAllByTestId('apps-listing-card').map((c: HTMLElement): string => c.dataset.appId ?? '');
const actionOf = (appId: string): HTMLButtonElement =>
  (screen.getAllByTestId('apps-listing').find((l: HTMLElement): boolean => l.dataset.appId === appId) as HTMLElement).querySelector('[data-testid="apps-listing-tab-action"]') as HTMLButtonElement;

describe('the marketplace for a tab', () => {
  afterEach(cleanup);

  it('lists only what can be a tab here, installed here first (control: the plain list has them all)', async () => {
    const h: Harness = harness({ installs: [installOf('com.acme.kanban', 'Workspace', { id: 'k' })] }, catalogueText([CALENDAR, KANBAN, ZONE_ONLY]));
    openForTab(h, true);
    await waitFor(() => expect(names()).toEqual(['com.acme.kanban', 'net.avarok.calendar']));
    expect(screen.getByTestId('apps-browse-for-tab').textContent).toBe('Apps that can be a tab on “Engineering”');
    expect([actionOf('com.acme.kanban').textContent, actionOf('net.avarok.calendar').textContent]).toEqual(['Add as a tab', 'Install and add']);
    cleanupAndOpenPlain(h);
    await waitFor(() => expect(names()).toHaveLength(3));
    expect(screen.queryByTestId('apps-browse-for-tab')).toBeNull();
  });

  it('an app already a tab here is not offered again', async () => {
    const h: Harness = harness({}, catalogueText([CALENDAR, KANBAN]));
    openForTab(h, true, ['net.avarok.calendar']);
    await waitFor(() => expect(names()).toEqual(['com.acme.kanban']));
  });

  it('"Add as a tab" adds it and closes; a refused add keeps the list open', async () => {
    const h: Harness = harness({ installs: [installOf('com.acme.kanban', 'Workspace', { id: 'k' })] }, catalogueText([KANBAN]));
    const ok: Recorded = openForTab(h, true);
    await waitFor(() => expect(names()).toEqual(['com.acme.kanban']));
    fireEvent.click(actionOf('com.acme.kanban'));
    await waitFor(() => expect(ok.closed).toEqual([true]));
    expect(ok.added).toEqual(['com.acme.kanban']);

    cleanup();
    const refused: Recorded = openForTab(harness({ installs: [installOf('com.acme.kanban', 'Workspace', { id: 'k' })] }, catalogueText([KANBAN])), false);
    await waitFor(() => expect(names()).toEqual(['com.acme.kanban']));
    fireEvent.click(actionOf('com.acme.kanban'));
    await waitFor(() => expect(refused.added).toEqual(['com.acme.kanban']));
    expect(refused.closed).toEqual([]);
    await waitFor(() => expect(actionOf('com.acme.kanban').disabled).toBe(false));
  });

  it('"Install and add" starts at this page and below, installs, then adds the tab', async () => {
    // Published to this workspace: the kernel fake installs what its registry lists.
    const h: Harness = harness({ permissions: new Set(MAY), visible: [CALENDAR_HERE] }, catalogueText([]));
    const r: Recorded = openForTab(h, true);
    fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
    await waitFor(() => expect(names()).toEqual(['net.avarok.calendar']));
    fireEvent.click(actionOf('net.avarok.calendar'));
    fireEvent.click(screen.getByTestId('apps-detail-install'));
    expect((screen.getByTestId('apps-scope-node_tree') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('apps-scope-continue'));
    await screen.findByTestId('apps-consent');
    fireEvent.pointerMove(window);
    act(() => { h.clock.advance(CONSENT_VISIBLE_MS); });
    fireEvent.click(screen.getByTestId('apps-consent-install'));
    await waitFor(() => expect(screen.queryByTestId('apps-install-progress')).toBeNull());
    expect((await screen.findByTestId('apps-install-tab')).textContent).toBe('It is now a tab on this page.');
    expect(r.added).toEqual(['net.avarok.calendar']);
  });
});

function cleanupAndOpenPlain(h: Harness): void {
  cleanup();
  render(<AppsModal open onOpenChange={(): void => undefined} request={{ kind: 'browse' }} deps={h.deps} viewer={viewerHolding(MAY)} />);
}
