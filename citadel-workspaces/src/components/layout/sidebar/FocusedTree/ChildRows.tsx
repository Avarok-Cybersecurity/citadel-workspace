/**
 * The children unfolded under a sibling -- the selected one's, or a peeked
 * one's -- behind a 1px accent guide, then the dashed "Add <level>" row.
 *
 * A peek's guide is fainter, so a preview never reads as the selection.
 */
import { Plus, Star } from 'lucide-react';
import { forwardRef, type ForwardedRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { nodeIcon } from '@/lib/citadel-apps/node-icon';
import type { DomainNode } from '../tree-node-types';
import type { ChildIndex } from '../focused-view';
import { AnimatePresence, ITEM_CLASS, useRowItem, useFadeOut, useLeaving, usePresenceInitial } from './tree-motion';
import { TreeRow } from './TreeRow';

interface ChildListProps {
  parent: DomainNode;
  items: DomainNode[];
  index: ChildIndex;
  level: number;
  isPeek: boolean;
  isMobile: boolean;
  /** "Add Room"; null hides the row (nothing may be added, or this person may not add). */
  addLabel: string | null;
  onSelect: (nodeId: string) => void;
  onAdd: (parentId: string) => void;
}

export function ChildList({ parent, items, index, level, isPeek, isMobile, addLabel, onSelect, onAdd }: ChildListProps): JSX.Element {
  const initial: boolean = usePresenceInitial();
  return (
    <ul
      role="group"
      className={cn('relative ml-[14px] flex flex-col gap-px border-l pl-2', isPeek ? 'border-primary-accent/40' : 'border-primary-accent')}
    >
      <AnimatePresence initial={initial} mode="popLayout">
        {items.map((child: DomainNode) => (
          <ChildRow
            key={child.id}
            node={child}
            level={level}
            parentId={parent.id}
            childCount={index.get(child.id)?.length ?? 0}
            isMobile={isMobile}
            onSelect={onSelect}
          />
        ))}
        {addLabel !== null && <AddRow key={`add:${parent.id}`} parent={parent} level={level} label={addLabel} isMobile={isMobile} onAdd={onAdd} />}
      </AnimatePresence>
    </ul>
  );
}

interface ChildRowProps {
  node: DomainNode;
  level: number;
  parentId: string;
  childCount: number;
  isMobile: boolean;
  onSelect: (nodeId: string) => void;
}

const ChildRow: ForwardRefExoticComponent<ChildRowProps & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, ChildRowProps>(function ChildRow({ node, level, parentId, childCount, isMobile, onSelect }: ChildRowProps, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
  const Icon: ReturnType<typeof nodeIcon> = nodeIcon(node);
  const leaving: boolean = useLeaving();
  const fade: MotionValue<number> = useFadeOut();
  return (
    <motion.li ref={ref} {...useRowItem()} style={{ opacity: fade }} role="none" className={cn(ITEM_CLASS, leaving && 'pointer-events-none')}>
      <TreeRow
        motionId={node.id}
        info={{ kind: 'child', nodeId: node.id, parentId, selected: false, expandable: childCount > 0, expanded: false }}
        level={level}
        leaving={leaving}
        expanded={childCount > 0 ? false : undefined}
        testId={`tree-node-${node.id}`}
        title={node.name}
        onActivate={() => onSelect(node.id)}
        className={cn('gap-2 px-1.5 text-foreground transition-colors [&>svg]:size-[13px] hover:bg-primary-accent/15 hover:text-foreground', isMobile ? 'h-[44px]' : 'h-[28px]')}
      >
        <Icon className="h-[13px] w-[13px] shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{node.name}</span>
          {node.is_default && (
            <Star
              className="h-2.5 w-2.5 shrink-0 fill-warning text-warning-emphasis"
              aria-label={`Default ${getEntityTypeString(node.entity_type).toLowerCase()}`}
            />
          )}
        </span>
        {childCount > 0 && <span className="shrink-0 text-xs text-muted-foreground">{childCount}</span>}
      </TreeRow>
    </motion.li>
  );
});

interface AddRowProps {
  parent: DomainNode;
  level: number;
  /** "Add Room". */
  label: string;
  isMobile: boolean;
  onAdd: (parentId: string) => void;
}

/** The dashed "Add <level>" row: arrives, folds and leaves with the rows it follows. */
const AddRow: ForwardRefExoticComponent<AddRowProps & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, AddRowProps>(function AddRow({ parent, level, label, isMobile, onAdd }: AddRowProps, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
  const leaving: boolean = useLeaving();
  const fade: MotionValue<number> = useFadeOut();
  return (
    <motion.li ref={ref} {...useRowItem()} style={{ opacity: fade }} role="none" className={cn(leaving && 'pointer-events-none')}>
      {/* A treeitem rather than a bare button: a tree may hold only items, and the keyboard reaches it like one. */}
      <TreeRow
        motionId={`add:${parent.id}`}
        info={{ kind: 'child', nodeId: `add:${parent.id}`, parentId: parent.id, selected: false, expandable: false, expanded: false }}
        level={level}
        leaving={leaving}
        testId={`add-child-row-${parent.id}`}
        title={`${label} to ${parent.name}`}
        onActivate={() => onAdd(parent.id)}
        className={cn('gap-2 px-1.5 text-xs text-muted-foreground hover:bg-primary-accent/15 hover:text-foreground [&>svg]:size-3', isMobile ? 'h-[44px]' : 'h-[26px]')}
      >
        <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </TreeRow>
    </motion.li>
  );
});
