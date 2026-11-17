/**
 * The focused sidebar is a pure function of the selection; these pin it.
 *
 * The fixture is the design's six levels -- Workspace → City → Building →
 * Floor → Office → Room -- with level names that are deliberately not the
 * default template's, because nothing in the view may depend on them.
 */
import { describe, it, expect } from 'vitest';
import type { DomainNode } from '../tree-node-types';
import { workspaceRoot } from '../tree-node-utils';
import { childIndex, focusedView, stackRows, STACK_VISIBLE_ROWS, type FocusedView, type StackRow } from '../focused-view';
import { searchResults, type SearchResult } from '../focused-search';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

function node(id: string, parent: string | null, type: string, name: string = id): DomainNode {
  return {
    id, parent_id: parent, entity_type: { Child: type }, depth: 0, name, description: '', owner_id: '',
    members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false,
    chat_channel_id: null, default_permissions: {} as DomainNode['default_permissions'], metadata: [],
    allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
  };
}

/** Two cities at the top, so the workspace root is the synthetic one, as on a real server. */
const SIX: DomainNode[] = [
  node('berlin', WORKSPACE_ROOT_ID, 'City', 'Berlin'),
  node('munich', WORKSPACE_ROOT_ID, 'City', 'Munich'),
  node('alex', 'berlin', 'Building', 'Alexanderplatz 1'),
  node('floor3', 'alex', 'Floor', 'Floor 3'),
  node('floor1', 'alex', 'Floor', 'Floor 1'),
  node('eng', 'floor3', 'Desk', 'Engineering'),
  node('design', 'floor3', 'Desk', 'Design'),
  node('flex', 'eng', 'Seat', 'Flex HQ'),
  node('standup', 'eng', 'Seat', 'Standup'),
  node('subflex', 'flex', 'Seat', 'Sub-Flex'),
];

function viewOf(nodes: DomainNode[], selectedId: string | null): FocusedView {
  const map: Record<string, DomainNode> = Object.fromEntries(nodes.map((n: DomainNode) => [n.id, n]));
  const root: DomainNode = workspaceRoot(nodes, 'Lexelnet') as DomainNode;
  return focusedView({ nodes: map, children: childIndex(map, root), selectedId, root });
}

const ids = (list: DomainNode[]): string[] => list.map((n: DomainNode) => n.id);

describe('focusedView', () => {
  it('stacks the path, lists the peers and unfolds only the selection, six levels deep', () => {
    const view: FocusedView = viewOf(SIX, 'flex');
    expect(ids(view.ancestors)).toEqual([WORKSPACE_ROOT_ID, 'berlin', 'alex', 'floor3', 'eng']);
    expect(view.selected.id).toBe('flex');
    // Sorted by name, not by insertion.
    expect(ids(view.siblings)).toEqual(['flex', 'standup']);
    expect(ids(view.children)).toEqual(['subflex']);
  });

  it('shows the workspace alone, with the top level beneath it, when the root is selected', () => {
    for (const selected of [null, WORKSPACE_ROOT_ID]) {
      const view: FocusedView = viewOf(SIX, selected);
      expect(view.ancestors).toEqual([]);
      expect(ids(view.siblings)).toEqual([WORKSPACE_ROOT_ID]);
      expect(view.selected.name).toBe('Lexelnet');
      expect(ids(view.children)).toEqual(['berlin', 'munich']);
    }
  });

  it('promotes a synthetic root over several real ones, and over a single one too', () => {
    expect(viewOf(SIX, 'berlin').ancestors.map((n: DomainNode) => n.entity_type)).toEqual(['Workspace']);
    const lone: DomainNode[] = [node('only', null, 'City', 'Only'), node('kid', 'only', 'Building')];
    const view: FocusedView = viewOf(lone, 'only');
    // The single top-level space is a space, not the workspace: it sits under the root, not in its place.
    expect(ids(view.ancestors)).toEqual([WORKSPACE_ROOT_ID]);
    expect(ids(view.siblings)).toEqual(['only']);
  });

  it('uses the real root when the server sends it', () => {
    const withRoot: DomainNode[] = [{ ...node(WORKSPACE_ROOT_ID, null, 'x', 'Stored root'), entity_type: 'Workspace' }, ...SIX];
    const view: FocusedView = viewOf(withRoot, 'alex');
    expect(view.ancestors.map((n: DomainNode) => n.name)).toEqual(['Stored root', 'Berlin']);
    expect(ids(viewOf(withRoot, null).children)).toEqual(['berlin', 'munich']);
  });

  it('follows a moved node to its new parent', () => {
    const moved: DomainNode[] = SIX.map((n: DomainNode) => (n.id === 'eng' ? { ...n, parent_id: 'floor1' } : n));
    const view: FocusedView = viewOf(moved, 'eng');
    expect(ids(view.ancestors)).toEqual([WORKSPACE_ROOT_ID, 'berlin', 'alex', 'floor1']);
    expect(ids(view.siblings)).toEqual(['eng']);
  });

  it('falls back to the workspace when the selection was deleted', () => {
    const view: FocusedView = viewOf(SIX.filter((n: DomainNode) => n.id !== 'flex'), 'flex');
    expect(view.selected.id).toBe(WORKSPACE_ROOT_ID);
    expect(view.ancestors).toEqual([]);
  });

  it('survives a parent_id cycle rather than hanging', () => {
    const cyclic: DomainNode[] = [node('a', 'b', 'X'), node('b', 'a', 'X'), node('top', null, 'X'), node('top2', null, 'X')];
    expect(ids(viewOf(cyclic, 'a').ancestors)).toEqual([WORKSPACE_ROOT_ID, 'b']);
  });
});

describe('stackRows', () => {
  const chain = (length: number): DomainNode[] => Array.from({ length }, (_: unknown, i: number) => node(`n${i}`, null, 'X'));

  it('shows every ancestor below the threshold', () => {
    expect(stackRows(chain(9), false)).toHaveLength(9);
  });

  it('folds the middle of ten or more into one row, keeping the root and the nearest five', () => {
    const rows: StackRow[] = stackRows(chain(12), false);
    expect(rows).toHaveLength(STACK_VISIBLE_ROWS);
    expect(rows[0]).toMatchObject({ kind: 'node', level: 1 });
    expect(rows[1]).toMatchObject({ kind: 'more' });
    expect(rows[1].kind === 'more' && ids(rows[1].hidden)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    // True depth survives the fold.
    expect(rows.slice(2).map((r: StackRow) => (r.kind === 'node' ? r.level : 0))).toEqual([8, 9, 10, 11, 12]);
  });

  it('shows them all once expanded', () => {
    expect(stackRows(chain(12), true)).toHaveLength(12);
  });
});

describe('searchResults', () => {
  it('lists every match with its path, so two Floor 1s are two places', () => {
    const nodes: DomainNode[] = [...SIX, node('marien', 'munich', 'Building', 'Marienplatz 5'), node('mfloor1', 'marien', 'Floor', 'Floor 1')];
    const map: Record<string, DomainNode> = Object.fromEntries(nodes.map((n: DomainNode) => [n.id, n]));
    const root: DomainNode = workspaceRoot(nodes, 'Lexelnet') as DomainNode;
    const found: SearchResult[] = searchResults(map, root, 'floor 1');
    expect(found.map((r: SearchResult) => r.path.join(' › '))).toEqual([
      'Lexelnet › Berlin › Alexanderplatz 1',
      'Lexelnet › Munich › Marienplatz 5',
    ]);
    expect(searchResults(map, root, '   ')).toEqual([]);
    expect(searchResults(map, root, 'lexel').map((r: SearchResult) => r.node.id)).toEqual([WORKSPACE_ROOT_ID]);
  });
});
