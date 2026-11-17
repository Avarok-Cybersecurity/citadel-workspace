/**
 * A row of the sibling list, at full width whatever its depth: the selected
 * node or one of its peers, with the selected node's children (or a peeked
 * peer's) unfolded beneath it.
 *
 * The peek chevron and the ⋯ menu are real <button>s on the row, which is a
 * treeitem div rather than a button -- see TreeRow for why that is the one
 * arrangement both ARIA and axe accept.
 */
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import { forwardRef, type ForwardedRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { nodeIcon } from '@/lib/citadel-apps/node-icon';
import { rowClass } from '../selected-row';
import type { DomainNode } from '../tree-node-types';
import type { ChildIndex } from '../focused-view';
import { ITEM_CLASS, PresenceScope, useRowItem, useFadeOut, useLeaving } from './tree-motion';
import { Unfold } from './tree-boxes';
import { NodeActionsMenu, type NodeActions } from './NodeActionsMenu';
import { ChildList } from './ChildRows';
import { childCountLabel, rootLabel } from './level-labels';
import { TreeRow } from './TreeRow';

interface SiblingRowProps {
  node: DomainNode;
  level: number;
  /** The selected node's parent; null when this is the workspace root. */
  parentId: string | null;
  isSelected: boolean;
  isRoot: boolean;
  index: ChildIndex;
  isPeek: boolean;
  isMobile: boolean;
  /** "Add Room" for this node's Add row; null hides it. */
  addLabel: string | null;
  actions: NodeActions;
  onSelect: (nodeId: string) => void;
  onTogglePeek: (nodeId: string) => void;
  onAdd: (parentId: string) => void;
}

export const SiblingRow: ForwardRefExoticComponent<SiblingRowProps & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, SiblingRowProps>(function SiblingRow({
  node, level, parentId, isSelected, isRoot, index, isPeek, isMobile, addLabel, actions, onSelect, onTogglePeek, onAdd,
}: SiblingRowProps, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
  const children: DomainNode[] = index.get(node.id) ?? [];
  const hasChildren: boolean = children.length > 0;
  const unfolded: boolean = isSelected || isPeek;
  const canPeek: boolean = hasChildren && !isSelected;
  const Icon: ReturnType<typeof nodeIcon> = nodeIcon(node);
  const height: string = isMobile ? 'h-[44px]' : isRoot ? 'h-[36px]' : 'h-[30px]';
  const leaving: boolean = useLeaving();
  const fade: MotionValue<number> = useFadeOut();

  return (
    <motion.li ref={ref} {...useRowItem()} style={{ opacity: fade }} role="none" className={cn(ITEM_CLASS, leaving && 'pointer-events-none')}>
      <TreeRow
        motionId={node.id}
        info={{ kind: 'sibling', nodeId: node.id, parentId, selected: isSelected, expandable: hasChildren, expanded: unfolded && hasChildren }}
        level={level}
        leaving={leaving}
        expanded={hasChildren || isSelected ? unfolded : undefined}
        isActive={isSelected}
        testId={`tree-node-${node.id}`}
        title={node.name}
        onActivate={() => onSelect(node.id)}
        className={cn(
          'group',
          rowClass(isSelected),
          // The tint, the outline and the text cross-fade as the selection moves between peers.
          'transition-[color,background-color,box-shadow] duration-150 gap-2 pl-2',
          height,
          canPeek ? 'pr-[56px]' : 'pr-8',
        )}
      >
        {isRoot ? (
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
            <Icon className="h-3 w-3" />
          </span>
        ) : (
          <Icon className="h-[14px] w-[14px] shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate', isRoot && 'font-semibold')}>{node.name}</span>
            {node.is_default && (
              <Star
                className="h-3 w-3 shrink-0 fill-warning text-warning-emphasis"
                aria-label={`Default ${getEntityTypeString(node.entity_type).toLowerCase()}`}
              />
            )}
          </span>
          {isRoot && (
            <span className="truncate text-xs text-muted-foreground">
              <span className="uppercase tracking-[.06em]">{rootLabel(node)}</span>
              {hasChildren ? ` · ${childCountLabel(children)}` : ''}
            </span>
          )}
        </span>
        {hasChildren && !unfolded && <span className="shrink-0 text-xs text-muted-foreground">{children.length}</span>}
        {!leaving && (
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {canPeek && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onTogglePeek(node.id); }}
                aria-label={isPeek ? `Collapse ${node.name}` : `Expand ${node.name}`}
                aria-expanded={isPeek}
                data-testid={`tree-node-toggle-${node.id}`}
                className="tap-target flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary-accent/15 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
              >
                {isPeek ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            )}
            <NodeActionsMenu node={node} {...actions} />
          </div>
        )}
      </TreeRow>
      <PresenceScope>
        <Unfold open={unfolded && (hasChildren || addLabel !== null)} id={`${node.id}:children`}>
          <ChildList
            parent={node}
            items={children}
            index={index}
            level={level + 1}
            isPeek={!isSelected}
            isMobile={isMobile}
            addLabel={addLabel}
            onSelect={onSelect}
            onAdd={onAdd}
          />
        </Unfold>
      </PresenceScope>
    </motion.li>
  );
});
