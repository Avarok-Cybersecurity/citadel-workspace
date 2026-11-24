/**
 * End to end through the real sidebar, menu, dialog, candidate rule, zone data port and service:
 * "New app page…" on a node lists only the installs that may be a page there, creates a child at
 * the schema level whose metadata is the v2 envelope naming the chosen install, and with nothing
 * that may be a page there says so and offers the Apps marketplace instead of an empty list.
 *
 * Mocked, each for a reason:
 *   - `sessionAppsTransport`: the apps boundary (the tab's workspace session). It answers
 *     ListInstalls and GetListing as the kernel does, so zone-data.ts and page-candidates.ts run.
 *   - `WorkspaceService.sendProtocolRequest`: the protocol sender; it records CreateNode and emits
 *     the server's answer, so createNode and the write gate run for real.
 *   - `usePermission`: agent I/O.
 *
 * Negative controls (each applied, seen red, reverted): writing the v1 envelope (`encodeNodeApp`)
 * instead fails the decode; TreeNodesSection not passing `onNewAppPage` fails every case at the menu;
 * a doubled candidate list fails "lists only";
 * the empty state without its Browse apps button fails "offers the Apps marketplace".
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppInstall, AppListing, WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import WorkspaceService from '@/lib/workspace-service';
import { eventEmitter } from '@/lib/event-emitter';
import { decodeNodeApp } from '@/lib/citadel-apps/node-app-metadata';
import type { AppsRequest } from 'citadel-workspace-client-ts';
import type { AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import { closeAppsModal, useAppsModalRequest, type AppsModalRequest } from '@/lib/citadel-apps/apps-modal-store';
import type { WorkspaceRequestView } from '@/types/workspace-protocol';
import { viewOf } from '@/test-utils/request-view';
import { installOf, listingOf } from '@/test/app-manifests';
import { ESTATE, renderHierarchy } from './render-hierarchy';

const kernel: { installs: AppInstall[]; listings: Map<string, AppListing> } = vi.hoisted(() => ({ installs: [], listings: new Map() }));
vi.mock('@/lib/citadel-apps/apps-api', () => ({
  sessionAppsTransport: {
    request: async (request: AppsRequest): Promise<AppsAnswer> => {
      if (request === 'ListInstalls') return { kind: 'installs', installs: kernel.installs, disabledForMe: [], peerForMe: [] };
      const asked: string | undefined = typeof request === 'object' && 'GetListing' in request ? request.GetListing.app_id : undefined;
      const listing: AppListing | undefined = asked === undefined ? undefined : kernel.listings.get(asked);
      if (listing === undefined) throw new Error(`this test's kernel answers ListInstalls and known listings, not ${JSON.stringify(request)}`);
      return { kind: 'listing', listing };
    },
  },
}));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));

const PAGE_APP: string = 'work.synchronized.app';
const TAB_APP: string = 'work.kanban.app';
const listed = (id: string, name: string, surfaces: ('node_page' | 'node_tab')[]): [string, AppListing] => [id, listingOf({ id, name, version: '1.0.0', surfaces, scopes: ['workspace', 'node_tree'] })];

function recordRequests(): WorkspaceRequestView[] {
  const sent: WorkspaceRequestView[] = [];
  vi.spyOn(WorkspaceService, 'sendProtocolRequest').mockImplementation(async (request: WorkspaceProtocolRequest): Promise<void> => {
    sent.push(viewOf(request));
    const create: WorkspaceRequestView['CreateNode'] = viewOf(request).CreateNode;
    if (create) setTimeout(() => eventEmitter.emit('workspace:raw-response', { Node: { id: 'new-page', parent_id: create.parent_id, name: create.name } }), 0);
  });
  return sent;
}

/** What the Apps modal host would be asked to show. */
function AppsModalProbe(): JSX.Element {
  const asked: AppsModalRequest | null = useAppsModalRequest();
  return <output data-testid="apps-modal-request">{asked === null ? '' : asked.kind}</output>;
}

async function openNewAppPage(): Promise<HTMLElement> {
  renderHierarchy(ESTATE, '/workspace?nodeId=alex', <AppsModalProbe />);
  await userEvent.click(await screen.findByTestId('tree-node-menu-alex'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New app page…' }));
  return screen.findByRole('dialog', { name: 'New app page in Alexanderplatz 1' });
}

afterEach((): void => { kernel.installs = []; kernel.listings.clear(); closeAppsModal(); vi.restoreAllMocks(); });

describe('New app page', () => {
  it('lists only the installs that may be a page here, and creates the child bound to the chosen one', async () => {
    kernel.listings = new Map([listed(PAGE_APP, 'Synchronized', ['node_page']), listed(TAB_APP, 'Kanban', ['node_tab'])]);
    kernel.installs = [installOf(TAB_APP, 'Workspace', { id: 'inst-tab' }), installOf(PAGE_APP, { Node: 'alex' }, { id: 'inst-node' }), installOf(PAGE_APP, 'Workspace', { id: 'inst-ws' })];
    const sent: WorkspaceRequestView[] = recordRequests();
    const dialog: HTMLElement = await openNewAppPage();

    const apps: HTMLElement = await within(dialog).findByRole('radiogroup', { name: 'App' });
    expect(within(apps).getAllByRole('radio')).toHaveLength(1);
    expect(within(dialog).getByTestId('new-app-page-create')).toBeDisabled();
    await userEvent.click(within(apps).getByRole('radio', { name: /Synchronized/ }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Sync board');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create page' }));

    await waitFor(() => expect(screen.queryByTestId('new-app-page-dialog')).toBeNull());
    const create: WorkspaceRequestView['CreateNode'] = sent.find((r: WorkspaceRequestView) => r.CreateNode)?.CreateNode;
    expect(create).toMatchObject({ parent_id: 'alex', entity_type: { Child: 'Floor' }, name: 'Sync board' });
    expect(decodeNodeApp(create?.metadata ?? [])).toEqual({ kind: 'installed', app: PAGE_APP, installId: 'inst-ws' });
  });

  it('with nothing that may be a page here, says so and offers the Apps marketplace', async () => {
    kernel.listings = new Map([listed(TAB_APP, 'Kanban', ['node_tab'])]);
    kernel.installs = [installOf(TAB_APP, 'Workspace', { id: 'inst-tab' })];
    const dialog: HTMLElement = await openNewAppPage();
    const empty: HTMLElement = await within(dialog).findByTestId('new-app-page-empty');
    expect(empty.textContent).toContain('No app installed here can be a page.');
    expect(within(dialog).queryByRole('radiogroup', { name: 'App' })).toBeNull();
    expect(screen.getByTestId('apps-modal-request').textContent).toBe('');
    await userEvent.click(within(empty).getByRole('button', { name: 'Browse apps' }));
    expect(screen.getByTestId('apps-modal-request').textContent).toBe('browse');
    await waitFor(() => expect(screen.queryByTestId('new-app-page-dialog')).toBeNull());
  });
});
