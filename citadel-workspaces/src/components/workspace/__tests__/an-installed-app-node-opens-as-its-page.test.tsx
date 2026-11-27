/**
 * A node whose `citadel_app` envelope is v2 (node-page-abi.md §2, §3) opens as the installed app's
 * page: WorkspaceView routes it to AppNodePage, which mounts the bound install through the page
 * runtime's `mountPage` (Surface `node_page`) under the node's breadcrumbs, with no MDX chrome (no
 * Edit button, no editor, no BaseOffice) and no document host. (A v1 node opening its document is
 * a-document-is-created-and-opens-in-its-app.test.tsx's.)
 *
 * Real: WorkspaceView, AppNodePage, NodePane, AppZonePage, AppPagePane, the zone data port.
 * Doubled, each for a reason: the page runtime (lazy-runtime.ts; the real one needs a worker and a
 * kernel, and runtime-rig tests run it), `sessionAppsTransport` (the apps boundary; it answers
 * ListInstalls and GetListing as the kernel does), the chat and call components (they need a live
 * session), `usePermission` (agent I/O), BaseOffice (compiles MDX; only whether it is chosen is
 * under test) and the tab identity (the tab's IndexedDB session read).
 *
 * Negative controls (each applied, seen red, reverted): WorkspaceView not routing `installed` to
 * AppNodePage fails the mount; AppPagePane mounting through `mountPane` (a tab) fails it too.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppInstall, AppListing, AppsRequest } from 'citadel-workspace-client-ts';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import type { TabIdentity } from '@/lib/tab-identity';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { encodeNodeAppPage } from '@/lib/citadel-apps/node-app-metadata';
import type { AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { AppPageMount, AppZoneHandle, ZoneHost } from '@/components/office/app-zone/app-zone-environment';
import { installOf, listingOf } from '@/test/app-manifests';
import { domainNode } from '@/components/layout/sidebar/__tests__/render-hierarchy';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

const APP: string = 'work.synchronized.app';
const mounted: { pages: AppPageMount[] } = vi.hoisted(() => ({ pages: [] }));
const kernel: { installs: AppInstall[]; listing: AppListing | null } = vi.hoisted(() => ({ installs: [], listing: null }));

vi.mock('@/components/office/app-zone/lazy-runtime', () => {
  const refuse = (): AppZoneHandle => { throw new Error('a node page mounts no zone and no tab'); };
  return {
    pageZoneRuntime: {
      mount: refuse, mountPane: refuse, bindGlue: (): (() => void) => () => undefined,
      mountPage: (slots: ZoneHost, page: AppPageMount): AppZoneHandle => {
        mounted.pages.push(page);
        slots.canvas.dataset.appState = 'running';
        return { close: async (): Promise<void> => undefined };
      },
    },
  };
});
vi.mock('@/lib/citadel-apps/apps-api', () => ({
  sessionAppsTransport: {
    request: async (request: AppsRequest): Promise<AppsAnswer> => {
      if (request === 'ListInstalls') return { kind: 'installs', installs: kernel.installs, disabledForMe: [], peerForMe: [] };
      if (kernel.listing !== null && typeof request === 'object' && 'GetListing' in request) return { kind: 'listing', listing: kernel.listing };
      throw new Error(`this test's kernel does not answer ${JSON.stringify(request)}`);
    },
  },
}));
vi.mock('@/components/office/NodeChat', () => ({ NodeChat: (): JSX.Element => <div data-testid="chat-view" /> }));
vi.mock('@/components/call/GroupCallControls', () => ({ GroupCallControls: (): JSX.Element => <div /> }));
vi.mock('@/components/call/GroupCallDock', () => ({ GroupCallDock: (): JSX.Element => <div /> }));
vi.mock('@/hooks/use-domain-call-members', () => ({ useDomainCallMembers: (): unknown => ({ callable: [], notConnected: [] }) }));
vi.mock('@/hooks/use-tab-identity', () => ({ useTabIdentity: (): TabIdentity => ({ username: 'alice', cid: 11n }), readTabIdentity: async (): Promise<TabIdentity> => ({ username: 'alice', cid: 11n }) }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({ allowed: false, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {} }) as UsePermissionResult,
}));
vi.mock('@/components/office/BaseOffice', () => ({ BaseOffice: (): JSX.Element => <article data-testid="page" /> }));

const { WorkspaceView } = await import('../WorkspaceView');

function show(node: DomainNode): void {
  const state: WorkspaceState = {
    workspace: { id: 'root', name: 'Lexelnet' }, currentUser: { username: 'alice' },
    nodes: { berlin: domainNode('berlin', null, 'City', ['Building'], 'Berlin'), [node.id]: node },
    members: {}, treeSchema: { rules: [] }, loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceState;
  render(<MemoryRouter><ConfirmDialogProvider><TooltipProvider><WorkspaceProvider state={state}><WorkspaceView nodeId={node.id} /></WorkspaceProvider></TooltipProvider></ConfirmDialogProvider></MemoryRouter>);
}

describe('a node bound to an installed app’s page', () => {
  it('opens as the app filling the pane under its breadcrumbs, with no MDX chrome', async () => {
    kernel.listing = listingOf({ id: APP, name: 'Synchronized', version: '1.0.0', surfaces: ['node_page'], scopes: ['workspace'] });
    kernel.installs = [installOf(APP, 'Workspace', { id: 'inst-a' })];
    const metadata: Uint8Array = encodeNodeAppPage(null, { app: APP, installId: 'inst-a' });
    show({ ...domainNode('board', 'berlin', 'Building', [], 'Sync board'), metadata });

    await waitFor(() => expect(mounted.pages).toHaveLength(1));
    expect(mounted.pages[0]).toMatchObject({ install: { id: 'inst-a' }, nodeId: 'board', me: 'alice', manifest: { id: APP } });
    const page: HTMLElement = screen.getByTestId('app-node-page');
    expect(page.dataset.appId).toBe(APP);
    expect(screen.getByRole('navigation', { name: /breadcrumb/i }).textContent).toContain('Sync board');
    expect(screen.getByTestId('app-page-host')).toBeTruthy();
    expect([screen.queryByTestId('page'), screen.queryByTestId('document-host'), screen.queryByRole('button', { name: /^Edit/ })]).toEqual([null, null, null]);
  });
});
