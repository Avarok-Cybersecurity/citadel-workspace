/**
 * The marketplace's lists: loading, empty, listed, searched, a source that failed, the Requests
 * tab only for those who manage apps, metadata drawn as text, and a deep link to an app that is
 * hidden reading exactly like one to an app that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { catalogueText, harness, openModal, viewerHolding, type Harness } from './marketplace-harness';
import type { AppListing } from 'citadel-workspace-client-ts';
import type { AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';
import { listingOf } from '@/test/app-manifests';
import { NOT_AVAILABLE_COPY } from '@/lib/citadel-apps/refusal-copy';

const KANBAN: AppListing = listingOf({ id: 'com.acme.kanban', name: 'Kanban', summary: 'Cards in columns', categories: ['planning'] });
const NOTES: AppListing = listingOf({ id: 'com.acme.notes', name: 'Notes', summary: 'Plain notes', categories: ['documents'] });
const cards = (): string[] => screen.queryAllByTestId('apps-listing-card').map((c: HTMLElement) => c.textContent ?? '');
const linkTo = (appId: string): AppsModalRequest => ({ kind: 'link' as const, link: { appId, nodeId: null, version: null, server: null } });

describe('the marketplace lists', () => {
  it('shows loading until the sources answer, then the global listings', async () => {
    const h: Harness = harness({}, catalogueText([KANBAN, NOTES]));
    h.kernel.pause();
    openModal(h, viewerHolding(new Set(['AppInstall'])));
    expect(screen.getByTestId('apps-browse-loading')).toBeTruthy();
    h.kernel.resume();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.queryByTestId('apps-browse-loading')).toBeNull();
  });

  it('says when a tab has nothing', async () => {
    openModal(harness({}, catalogueText([])), viewerHolding(new Set()));
    expect((await screen.findByTestId('apps-browse-empty')).textContent).toBe('No apps are in the global catalogue yet.');
  });

  it('searches name, summary and category; nothing found says what was searched', async () => {
    openModal(harness({}, catalogueText([KANBAN, NOTES])), viewerHolding(new Set()));
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.change(screen.getByTestId('apps-search'), { target: { value: 'documents' } });
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toContain('Notes');
    fireEvent.change(screen.getByTestId('apps-search'), { target: { value: 'spreadsheets' } });
    expect(screen.getByTestId('apps-browse-none-found').textContent).toBe('No apps match “spreadsheets”.');
  });

  it('a catalogue that failed to load says so and still lists the workspace’s apps', async () => {
    openModal(harness({ visible: [listingOf({ id: 'com.acme.notes', name: 'Notes' }, 'workspace')] }, new Error('offline')), viewerHolding(new Set()));
    expect((await screen.findByTestId('apps-browse-problem')).textContent).toBe('The global catalogue could not be loaded.');
    fireEvent.mouseDown(screen.getByTestId('apps-tab-workspace'));
    await waitFor(() => expect(within(screen.getByTestId('apps-browse-workspace')).getAllByTestId('apps-listing-card')).toHaveLength(1));
  });

  it('metadata are text, never markup', async () => {
    const hostile: AppListing = listingOf({ id: 'com.acme.kanban', name: '<img src=x onerror=alert(1)>', summary: '<b>bold</b>' });
    openModal(harness({}, catalogueText([hostile])), viewerHolding(new Set()));
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card: HTMLElement = screen.getByTestId('apps-listing-card');
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.querySelector('img:not([data-testid])')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
  });

  it('Requests is a tab only for someone who manages apps; control: shown with AppManage', async () => {
    const first: RenderResult = openModal(harness({}, catalogueText([])), viewerHolding(new Set(['AppInstall'])));
    await screen.findByTestId('apps-browse-empty');
    expect(screen.queryByTestId('apps-tab-requests')).toBeNull();
    first.unmount();
    openModal(harness({}, catalogueText([])), viewerHolding(new Set(['AppManage'])));
    fireEvent.mouseDown(await screen.findByTestId('apps-tab-requests'));
    expect((await screen.findByTestId('apps-requests-empty')).textContent).toContain('No requests yet.');
  });
});

describe('a deep link', () => {
  it('to a listed app opens its detail', async () => {
    openModal(harness({ visible: [KANBAN] }, catalogueText([])), viewerHolding(new Set()), linkTo('com.acme.kanban'));
    expect((await screen.findByTestId('apps-listing-detail')).textContent).toContain('Kanban');
  });

  it('to a hidden app and to a missing one read the same', async () => {
    const hidden: RenderResult = openModal(harness({ hidden: [NOTES] }, catalogueText([])), viewerHolding(new Set()), linkTo('com.acme.notes'));
    const said: string = (await screen.findByTestId('apps-link-unavailable')).textContent ?? '';
    hidden.unmount();
    openModal(harness({}, catalogueText([])), viewerHolding(new Set()), linkTo('com.acme.nothing'));
    expect((await screen.findByTestId('apps-link-unavailable')).textContent).toBe(said);
    expect(said).toContain(NOT_AVAILABLE_COPY);
    expect(said).not.toContain('com.acme');
  });
});
