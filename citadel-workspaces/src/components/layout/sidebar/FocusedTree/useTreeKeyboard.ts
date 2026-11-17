/**
 * The focused tree's keyboard, after the WAI-ARIA tree pattern.
 *
 * ↑/↓ move through the visible rows in DOM order (stack, then siblings and
 * the children unfolded among them). ← on a sibling selects its parent -- it
 * climbs -- and on a child or an ancestor moves to the row above it in the
 * hierarchy. → on the selected row enters its first child; on another sibling
 * it peeks inside, and once peeked, enters. Enter and Space activate the row
 * (TreeRow), through the same handler the mouse does; on a button inside a row
 * (peek, ⋯) they are that button's own.
 *
 * Selecting re-renders the tree, and a row that changes list is a new element,
 * so the focus would fall to <body> under the keyboard user's feet. The row
 * that was acted on is remembered and focused again once it has rendered.
 *
 * The decision is `treeKeyAction`, pure, over what the row says about itself in
 * `treeItemAttributes`; the hook only reads the DOM and moves focus.
 */
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type MutableRefObject, type RefObject } from 'react';

export type TreeItemKind = 'ancestor' | 'sibling' | 'child';

export interface TreeItemInfo {
  kind: TreeItemKind;
  nodeId: string;
  /** The row above this one in the hierarchy; null for the workspace root. */
  parentId: string | null;
  selected: boolean;
  /** Has children to show. */
  expandable: boolean;
  /** Its children are on screen (selected, or peeked). */
  expanded: boolean;
}

export type TreeKeyAction =
  | { type: 'move'; by: 1 | -1 }
  | { type: 'select'; nodeId: string }
  | { type: 'peek'; nodeId: string }
  | { type: 'focus'; nodeId: string }
  | { type: 'first-child'; nodeId: string }
  | { type: 'activate'; nodeId: string };

export function treeKeyAction(key: string, item: TreeItemInfo): TreeKeyAction | null {
  // A row is a button, never a text field, so no composition can be in progress.
  if (key === 'Enter' || key === ' ') return { type: 'activate', nodeId: item.nodeId };
  switch (key) {
    case 'ArrowDown': return { type: 'move', by: 1 };
    case 'ArrowUp': return { type: 'move', by: -1 };
    case 'ArrowLeft':
      if (item.parentId === null) return null;
      return item.kind === 'sibling' ? { type: 'select', nodeId: item.parentId } : { type: 'focus', nodeId: item.parentId };
    case 'ArrowRight':
      if (item.kind === 'ancestor') return { type: 'move', by: 1 };
      if (!item.expandable) return null;
      if (item.kind === 'child') return { type: 'select', nodeId: item.nodeId };
      return item.expanded ? { type: 'first-child', nodeId: item.nodeId } : { type: 'peek', nodeId: item.nodeId };
    default: return null;
  }
}

/** The data attributes a row carries so the keyboard can read it back. */
export function treeItemAttributes(info: TreeItemInfo): Record<string, string> {
  return {
    'data-tree-kind': info.kind,
    'data-tree-node': info.nodeId,
    'data-tree-parent': info.parentId ?? '',
    'data-tree-selected': String(info.selected),
    'data-tree-expandable': String(info.expandable),
    'data-tree-expanded': String(info.expanded),
  };
}

function readItem(el: HTMLElement): TreeItemInfo {
  const parent: string = el.dataset.treeParent ?? '';
  return {
    kind: el.dataset.treeKind as TreeItemKind,
    nodeId: el.dataset.treeNode ?? '',
    parentId: parent === '' ? null : parent,
    selected: el.dataset.treeSelected === 'true',
    expandable: el.dataset.treeExpandable === 'true',
    expanded: el.dataset.treeExpanded === 'true',
  };
}

const ITEM: string = '[role="treeitem"]';

interface TreeKeyboardInput {
  /** Changes whenever the rows do; the remembered row is focused after it. */
  viewKey: string;
  onSelect: (nodeId: string) => void;
  onPeek: (nodeId: string) => void;
}

export interface TreeKeyboard {
  treeRef: RefObject<HTMLUListElement>;
  onKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void;
}

export function useTreeKeyboard({ viewKey, onSelect, onPeek }: TreeKeyboardInput): TreeKeyboard {
  const treeRef: RefObject<HTMLUListElement> = useRef<HTMLUListElement>(null);
  const pendingFocus: MutableRefObject<string | null> = useRef<string | null>(null);

  // A row that is not on screen (the selection moved elsewhere) is simply not focused.
  const focusNode: (nodeId: string) => void = useCallback((nodeId: string): void => {
    treeRef.current?.querySelector<HTMLElement>(`${ITEM}[data-tree-node="${CSS.escape(nodeId)}"]`)?.focus();
  }, []);

  useLayoutEffect((): void => {
    const nodeId: string | null = pendingFocus.current;
    // Cleared either way: a selection the editor guard cancelled must not pull
    // the focus to that row whenever it next happens to render.
    pendingFocus.current = null;
    if (nodeId !== null) focusNode(nodeId);
  }, [viewKey, focusNode]);

  const onKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void = useCallback((event: KeyboardEvent<HTMLUListElement>): void => {
    const row: HTMLElement | null = (event.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (!row || !treeRef.current) return;
    const action: TreeKeyAction | null = treeKeyAction(event.key, readItem(row));
    if (!action) return;
    if (action.type === 'activate') {
      // The row activates itself (TreeRow); a button on it (peek, ⋯) natively. Only the focus needs keeping.
      if (event.target === row) pendingFocus.current = action.nodeId;
      return;
    }
    event.preventDefault();
    const rows: HTMLElement[] = Array.from(treeRef.current.querySelectorAll<HTMLElement>(ITEM));
    switch (action.type) {
      case 'move': rows[rows.indexOf(row) + action.by]?.focus(); return;
      case 'focus': focusNode(action.nodeId); return;
      case 'select': pendingFocus.current = action.nodeId; onSelect(action.nodeId); return;
      case 'peek': pendingFocus.current = action.nodeId; onPeek(action.nodeId); return;
      case 'first-child':
        rows.find((r: HTMLElement): boolean => r.dataset.treeKind === 'child' && r.dataset.treeParent === action.nodeId)?.focus();
        return;
    }
  }, [focusNode, onSelect, onPeek]);

  return { treeRef, onKeyDown };
}
