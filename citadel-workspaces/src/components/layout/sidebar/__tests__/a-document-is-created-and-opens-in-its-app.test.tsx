/**
 * End to end through the real sidebar, dialog, service and view: "New document" on a node
 * creates a child at the level the live schema permits there, with the app in its metadata; a
 * node that may hold nothing offers the entry disabled with the reason; a document node shows
 * its app's icon in the tree and opens in DocumentHost instead of as a page.
 *
 * Types are City/Building/Floor (render-hierarchy's ESTATE), so a hard-coded "Room" cannot pass.
 * Mocked, each for a reason:
 *   - `WorkspaceService.sendProtocolRequest`: the protocol sender, the boundary to the WASM
 *     socket. It records the request and emits the server's answer, so createNode and the
 *     write gate run for real.
 *   - `usePermission`: agent I/O.
 *   - `BaseOffice`: compiles MDX and mounts chat; only whether it is chosen is under test.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import WorkspaceService from '@/lib/workspace-service';
import { eventEmitter } from '@/lib/event-emitter';
import { decodeNodeApp, encodeNodeApp } from '@/lib/citadel-apps/node-app-metadata';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { WorkspaceView } from '@/components/workspace/WorkspaceView';
import { ESTATE, domainNode, renderHierarchy } from './render-hierarchy';
import type { DomainNode } from '../tree-node-types';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));
vi.mock('@/components/office/BaseOffice', () => ({
  BaseOffice: ({ nodeId }: { nodeId?: string }): JSX.Element => <article data-testid="page" data-node={nodeId ?? 'home'} />,
}));

function Page(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  return <WorkspaceView nodeId={new URLSearchParams(location.search).get('nodeId')} />;
}

function recordRequests(): WorkspaceProtocolRequestTS[] {
  const sent: WorkspaceProtocolRequestTS[] = [];
  vi.spyOn(WorkspaceService, 'sendProtocolRequest').mockImplementation(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
    sent.push(request);
    const create: WorkspaceProtocolRequestTS['CreateNode'] = request.CreateNode;
    if (create) setTimeout(() => eventEmitter.emit('workspace:raw-response', { Node: { id: 'new-doc', parent_id: create.parent_id, name: create.name } }), 0);
  });
  return sent;
}

const PLAN: DomainNode = { ...domainNode('plan', 'alex', 'Floor', [], 'Quarterly plan'), metadata: Array.from(encodeNodeApp(null, 'docs')) };

describe('New document', () => {
  it('creates a child at the schema level with the app in its metadata', async () => {
    const sent: WorkspaceProtocolRequestTS[] = recordRequests();
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    await userEvent.click(await screen.findByTestId('tree-node-menu-alex'));
    await userEvent.click(await screen.findByTestId('new-document-alex'));

    const dialog: HTMLElement = await screen.findByTestId('new-document-dialog');
    await userEvent.click(within(dialog).getByTestId('new-document-app-docs'));
    await userEvent.type(within(dialog).getByTestId('new-document-name'), 'Fire plan');
    await userEvent.click(within(dialog).getByTestId('new-document-create'));

    await waitFor(() => expect(screen.queryByTestId('new-document-dialog')).toBeNull());
    const create: WorkspaceProtocolRequestTS['CreateNode'] = sent.find((r: WorkspaceProtocolRequestTS) => r.CreateNode)?.CreateNode;
    expect(create).toMatchObject({ parent_id: 'alex', entity_type: { Child: 'Floor' }, name: 'Fire plan' });
    expect(decodeNodeApp(create?.metadata ?? [])).toBe('docs');
  });

  it('is offered from the create form too, for the same parent', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=alex');
    await userEvent.click(await screen.findByTestId('tree-node-menu-alex'));
    await userEvent.click(await screen.findByTestId('create-child-alex'));
    await userEvent.click(await screen.findByTestId('node-modal-new-document'));
    const dialog: HTMLElement = await screen.findByTestId('new-document-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('New document in Alexanderplatz 1');
  });

  it('is offered disabled, with the reason, on a node that may hold nothing', async () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=floor3');
    await userEvent.click(await screen.findByTestId('tree-node-menu-floor3'));
    const entry: HTMLElement = await screen.findByTestId('new-document-floor3');
    expect(entry).toHaveAttribute('data-disabled');
    expect(entry).toHaveTextContent('Nothing can be added inside Floor 3');
  });
});

describe('a document node', () => {
  it('shows its app icon in the tree, and a plain node does not', async () => {
    renderHierarchy([...ESTATE, PLAN], '/workspace?nodeId=alex');
    const doc: HTMLElement = await screen.findByTestId('tree-node-plan');
    const plain: HTMLElement = screen.getByTestId('tree-node-floor3');
    expect(doc.querySelector('svg.lucide-file-text')).not.toBeNull();
    expect(plain.querySelector('svg.lucide-file-text')).toBeNull();
  });

  it('opens in DocumentHost, while a plain node still opens as a page', () => {
    renderHierarchy([...ESTATE, PLAN], '/workspace?nodeId=plan', <Page />);
    expect(screen.getByTestId('document-host')).toHaveAttribute('data-app', 'docs');
    expect(screen.getByRole('heading', { name: 'Quarterly plan' })).toBeInTheDocument();
    expect(screen.queryByTestId('page')).toBeNull();
  });

  it('leaves a plain node to the page view', () => {
    renderHierarchy(ESTATE, '/workspace?nodeId=floor3', <Page />);
    expect(screen.getByTestId('page')).toHaveAttribute('data-node', 'floor3');
    expect(screen.queryByTestId('document-host')).toBeNull();
  });
});
