/**
 * The focused hierarchy: the ancestor stack, then the selected node among its
 * siblings, with only the selected node's children unfolded (plus any peer the
 * user peeks into). Selection alone defines the view -- see focused-view.ts --
 * so only the peeks and an expanded deep stack are local state, and both reset
 * whenever the selection moves.
 *
 * Only ancestors, one sibling set and one child set are mounted, so a
 * 2,000-node estate costs what a 20-node one does.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { BROWSER_FRAMES, probeTransition } from '@/lib/motion-state';
import { MOTION_SECONDS } from '@/lib/motion';
import { SidebarMenu } from '@/components/ui/sidebar';
import type { DomainNode } from '../tree-node-types';
import { childIndex, focusedView, stackRows, type ChildIndex, type FocusedView, type StackRow } from '../focused-view';
import { AnimatePresence, PresenceScope, usePresenceInitial, useRememberOnScreen } from './tree-motion';
import { FadingItem, ScrollWhenTall, StackBox } from './tree-boxes';
import { AncestorRow, MoreAncestorsRow } from './AncestorRow';
import { SiblingRow } from './SiblingRow';
import type { NodeActions } from './NodeActionsMenu';
import { addChildLabel, childCountLabel } from './level-labels';
import { useTreeKeyboard, type TreeKeyboard } from './useTreeKeyboard';

/** The glide and the arrivals that finish with it, with as long again for a slow commit before them. */
const PROBE_MS: number = MOTION_SECONDS.layout * 1000 * 2;

interface FocusedTreeProps {
  nodes: Readonly<Record<string, DomainNode>>;
  root: DomainNode;
  selectedId: string | null;
  isMobile: boolean;
  /** The ⋯ menu's handlers for a stored node; the synthetic root offers only Admin Settings and Add. */
  actions: NodeActions;
  /** False when creating would be refused: no Add rows, no "Add Child". */
  canAdd: boolean;
  onSelect: (nodeId: string) => void;
  onAdd: (parentId: string) => void;
}

export function FocusedTree({ nodes, root, selectedId, isMobile, actions, canAdd, onSelect, onAdd }: FocusedTreeProps): JSX.Element {
  const index: ChildIndex = useMemo((): ChildIndex => childIndex(nodes, root), [nodes, root]);
  const view: FocusedView = useMemo(
    (): FocusedView => focusedView({ nodes, children: index, selectedId, root }),
    [nodes, index, selectedId, root],
  );
  const [peeked, setPeeked] = useState<ReadonlySet<string>>(new Set());
  const [stackOpen, setStackOpen] = useState<boolean>(false);
  const selectedBefore: MutableRefObject<string> = useRef<string>(view.selected.id);
  useEffect((): void => {
    setPeeked(new Set());
    setStackOpen(false);
    if (selectedBefore.current === view.selected.id) return;
    selectedBefore.current = view.selected.id;
    // A selection is the transition Auto watches: one that drops frames moves the rest of this page to lite.
    void probeTransition(BROWSER_FRAMES, PROBE_MS);
  }, [view.selected.id]);

  const togglePeek: (nodeId: string) => void = useCallback((nodeId: string): void => {
    setPeeked((prev: ReadonlySet<string>): ReadonlySet<string> => {
      const next: Set<string> = new Set(prev);
      if (!next.delete(nodeId)) next.add(nodeId);
      return next;
    });
  }, []);

  const keyboard: TreeKeyboard = useTreeKeyboard({
    viewKey: `${view.selected.id}|${[...peeked].join(',')}|${stackOpen}`,
    onSelect,
    onPeek: togglePeek,
  });

  const initial: boolean = usePresenceInitial();
  useRememberOnScreen(keyboard.treeRef);

  const rows: StackRow[] = stackRows(view.ancestors, stackOpen);
  const parent: DomainNode | undefined = view.ancestors[view.ancestors.length - 1];
  const isStoredRoot: boolean = Boolean(nodes[root.id]);
  const actionsFor = (node: DomainNode): NodeActions => {
    const withAdd: NodeActions = {
      ...actions,
      onNodeCreate: canAdd ? actions.onNodeCreate : undefined,
      onNewDocument: canAdd ? actions.onNewDocument : undefined,
    };
    if (node.id !== root.id || isStoredRoot) return withAdd;
    return { onAdminSettings: withAdd.onAdminSettings, onNodeCreate: withAdd.onNodeCreate, onNewDocument: withAdd.onNewDocument };
  };

  return (
    <SidebarMenu ref={keyboard.treeRef} role="tree" aria-label="Workspace hierarchy" onKeyDown={keyboard.onKeyDown} className="relative gap-0.5">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.length > 0 && (
          <StackBox key="ancestor-stack">
            <ul role="group" className="relative flex flex-col gap-px">
              <AnimatePresence initial={initial} mode="popLayout">
                {rows.map((row: StackRow, i: number) => row.kind === 'more' ? (
                  <MoreAncestorsRow key="more" hidden={row.hidden} level={i + 1} isMobile={isMobile} onExpand={() => setStackOpen(true)} />
                ) : (
                  <AncestorRow
                    key={row.node.id}
                    node={row.node}
                    level={row.level}
                    parentId={view.ancestors[row.level - 2]?.id ?? null}
                    childCountLabel={row.node.id === parent?.id ? childCountLabel(view.siblings) : null}
                    isMobile={isMobile}
                    onSelect={onSelect}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </StackBox>
        )}
      </AnimatePresence>
      {/* One list per parent: another parent's siblings leave where they stand, not riding the list to its new place. */}
      <AnimatePresence initial={false} mode="popLayout">
        <FadingItem key={`siblings-of:${parent?.id ?? 'none'}`}>
          <PresenceScope>
            {/* A very wide sibling set (sixty rooms on a floor) scrolls here; the stack above stays put. */}
            <ScrollWhenTall>
              <ul role="group" className="relative flex flex-col gap-0.5">
                <AnimatePresence initial={initial} mode="popLayout">
                  {view.siblings.map((sibling: DomainNode) => (
                    <SiblingRow
                      key={sibling.id}
                      node={sibling}
                      level={view.ancestors.length + 1}
                      parentId={parent?.id ?? null}
                      isSelected={sibling.id === view.selected.id}
                      isRoot={sibling.id === root.id}
                      index={index}
                      isPeek={peeked.has(sibling.id)}
                      isMobile={isMobile}
                      addLabel={canAdd ? addChildLabel(sibling) : null}
                      actions={actionsFor(sibling)}
                      onSelect={onSelect}
                      onTogglePeek={togglePeek}
                      onAdd={onAdd}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </ScrollWhenTall>
          </PresenceScope>
        </FadingItem>
      </AnimatePresence>
    </SidebarMenu>
  );
}
