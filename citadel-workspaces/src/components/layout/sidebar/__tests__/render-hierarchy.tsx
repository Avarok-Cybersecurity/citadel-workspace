/**
 * The real HierarchySidebar inside a real router, for specs of the focused tree.
 *
 * The URL is the selection, so the sidebar is rendered under a MemoryRouter and
 * the current location is printed beside it: a spec reads the `nodeId` the
 * sidebar navigated to, and the next render shows the view that URL selects --
 * the same round trip the app makes. Callers mock `usePermission` (agent I/O)
 * themselves, because vi.mock is hoisted per file.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { DomainNode } from '../tree-node-types';
import { HierarchySidebar } from '../HierarchySidebar';

// Test defaults (PCND): a leaf, named by its id -- the fields no case here is about.
export function domainNode(id: string, parent: string | null, type: string, allowed: string[] = [], name: string = id): DomainNode {
  return {
    id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '',
    members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false,
    chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'], metadata: [],
    allowed_child_types: allowed, is_default: false, created_at: 0n, updated_at: 0n,
  };
}

/** Workspace → Berlin/Munich → buildings → floors; types named so no default template name appears. */
export const ESTATE: DomainNode[] = [
  domainNode('berlin', WORKSPACE_ROOT_ID, 'City', ['Building'], 'Berlin'),
  domainNode('munich', WORKSPACE_ROOT_ID, 'City', ['Building'], 'Munich'),
  domainNode('alex', 'berlin', 'Building', ['Floor'], 'Alexanderplatz 1'),
  domainNode('potsdamer', 'berlin', 'Building', ['Floor'], 'Potsdamer Platz'),
  domainNode('floor3', 'alex', 'Floor', [], 'Floor 3'),
  domainNode('pfloor1', 'potsdamer', 'Floor', [], 'Floor 1'),
];

function Location(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

// Test defaults (PCND): the landing URL and nothing beside the sidebar, which most cases start from.
export function renderHierarchy(nodes: DomainNode[], initialEntry: string = '/workspace', extra: ReactNode = null): void {
  const state: WorkspaceState = {
    workspace: { id: WORKSPACE_ROOT_ID, name: 'Lexelnet' },
    nodes: Object.fromEntries(nodes.map((n: DomainNode) => [n.id, n])),
    members: {},
    treeSchema: { rules: [{ parent_type: 'Workspace', allowed_child_types: ['City'] }] },
    loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceState;
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ConfirmDialogProvider><TooltipProvider><SidebarProvider>
        <WorkspaceProvider state={state}>
          <HierarchySidebar />
          <Location />
          {extra}
        </WorkspaceProvider>
      </SidebarProvider></TooltipProvider></ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

/** The nodeId the sidebar last navigated to, or null for none. */
export function selectedInUrl(): string | null {
  return new URLSearchParams(screen.getByTestId('location').textContent ?? '').get('nodeId');
}
