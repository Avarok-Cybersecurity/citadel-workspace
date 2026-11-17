/**
 * The header bar says where you are in the hierarchy and takes you back up it.
 *
 * Owner, 2026-10-16: "on the bar that says LexelNet, we need to show the breadcrumbs of the
 * hierarchy that are navigatable". The levels are renamed from the default template's on
 * purpose: nothing here may depend on "Office" or "Room".
 *
 * Real: the path (lib/domain-path.ts), the breadcrumbs, the shared select (use-select-node), the
 * leave-the-editor guard and its dialog, the router and the workspace store. Nothing stood in.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { setTreeSchema } from '@/lib/entity-type-registry';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { clearUnsavedEditsForTests, registerUnsavedEdits } from '@/lib/unsaved-edits';
import { selectNodePath } from '@/hooks/use-select-node';
import type { DomainNode, TreeSchema } from '@/components/layout/sidebar/tree-node-types';
import { OfficeBreadcrumbs } from '../OfficeBreadcrumbs';

afterEach(cleanup);

const config = (type: string, label: string): TreeSchema['entity_type_configs'][number] => ({
  type_name: type, icon: 'folder', label, plural_label: `${label}s`, name_placeholder: '', description_placeholder: '',
});

function node(id: string, parent: string | null, type: string, name: string): DomainNode {
  return {
    id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '',
    members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false,
    chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'], metadata: [],
    allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
  };
}

const NODES: Record<string, DomainNode> = Object.fromEntries([
  node('hq', WORKSPACE_ROOT_ID, 'Office', 'HQ'),
  node('floor', 'hq', 'Floor', 'Third floor'),
  node('standup', 'floor', 'Room', 'Standup'),
].map((n: DomainNode) => [n.id, n]));

const STATE: WorkspaceState = { workspace: { id: 'w', name: 'LexelNet' }, members: {}, nodes: NODES } as unknown as WorkspaceState;
const START: string = '/workspace?nodeId=standup&showP2P=true&section=files';

function Where(): JSX.Element {
  const location: Location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function show(nodeId: string | null, current: string): void {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={[START]}>
        <WorkspaceProvider state={STATE}>
          <Where />
          <OfficeBreadcrumbs nodeId={nodeId} current={current} />
        </WorkspaceProvider>
      </MemoryRouter>
    </ConfirmDialogProvider>,
  );
}

const ancestorButtons = (): HTMLElement[] => within(screen.getByTestId('hierarchy-breadcrumbs')).queryAllByRole('button');

beforeAll(() => {
  setTreeSchema({ entity_type_configs: [config('Workspace', 'Company'), config('Office', 'Studio'), config('Floor', 'Level'), config('Room', 'Booth')] } as unknown as TreeSchema);
});
beforeEach(() => clearUnsavedEditsForTests());

describe('the header breadcrumbs', () => {
  it('run from the workspace down to here, by the live tree\'s names', () => {
    show('standup', 'Standup');
    expect(ancestorButtons().map((b: HTMLElement) => b.textContent)).toEqual(['LexelNet', 'HQ', 'Third floor']);
    expect(ancestorButtons().map((b: HTMLElement) => b.getAttribute('title'))).toEqual(['Company LexelNet', 'Studio HQ', 'Level Third floor']);
  });

  it('show here as the page heading, plain text, marked current, and not a control', () => {
    show('standup', 'Standup');
    const here: HTMLElement = screen.getByRole('heading', { level: 1, name: 'Standup' });
    expect(here.getAttribute('aria-current')).toBe('page');
    expect(here.closest('button')).toBeNull();
    expect(ancestorButtons().some((b: HTMLElement) => b.textContent === 'Standup')).toBe(false);
  });

  it('open an ancestor exactly as the sidebar does: the node, with the section and chat overlay cleared', async () => {
    const user: UserEvent = userEvent.setup();
    show('standup', 'Standup');
    await user.click(screen.getByRole('button', { name: 'HQ' }));
    const expected: string = selectNodePath('?nodeId=standup&showP2P=true&section=files', 'hq');
    expect(screen.getByTestId('where').textContent).toBe(expected);
    expect(expected).toMatch(/nodeId=hq/);
    expect(expected).not.toMatch(/showP2P|section/);
  });

  it("leave the file manager's own keys behind with its section", () => {
    const path: string = selectNodePath('?section=files&peer_id=server&path=%2FDesigns&item=a.pdf&via=7', 'hq');
    expect(path).toMatch(/nodeId=hq/);
    expect(path).not.toMatch(/section|peer_id|path=|item=|via=/);
  });

  it('ask before leaving a document with unsaved edits, and stay put when told to', async () => {
    const user: UserEvent = userEvent.setup();
    show('standup', 'Standup');
    registerUnsavedEdits('doc');
    await user.click(screen.getByRole('button', { name: 'LexelNet' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByTestId('where').textContent).toBe(START);
  });

  it('fold the middle into "…" on a phone, keeping the workspace and here', () => {
    show('standup', 'Standup');
    const [first, ...middle] = screen.getAllByTestId('breadcrumb-ancestor');
    expect(first.className).not.toMatch(/\bhidden\b/);
    for (const item of middle) expect(item.className).toMatch(/\bhidden md:flex\b/);
    expect(screen.getByTestId('breadcrumb-collapsed').className).toMatch(/\bmd:hidden\b/);
  });

  it('fold nothing when there is no middle, and offer no ancestor at the workspace itself', () => {
    show('hq', 'HQ');
    expect(ancestorButtons().map((b: HTMLElement) => b.textContent)).toEqual(['LexelNet']);
    expect(screen.queryByTestId('breadcrumb-collapsed')).toBeNull();
    cleanup();
    show(null, 'LexelNet');
    expect(ancestorButtons()).toEqual([]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('LexelNet');
  });
});
