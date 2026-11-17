/**
 * A row of the ancestor stack: the path from the workspace to the selected
 * node's parent, stepping in 6px a level so a level-10 name is as wide as a
 * level-2 one. Rows are 24px, not the design's 22: 24 is the target-size
 * floor. The first row is the workspace itself, promoted -- a filled tile and
 * its level's label -- so it never reads as a peer of a space.
 */
import { MoreHorizontal } from 'lucide-react';
import { forwardRef, type ForwardedRef, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';
import { nodeIcon } from '@/lib/citadel-apps/node-icon';
import type { DomainNode } from '../tree-node-types';
import { ITEM_CLASS, useRowItem, useFadeOut, useLeaving } from './tree-motion';
import { rootLabel } from './level-labels';
import { TreeRow } from './TreeRow';

interface AncestorRowProps {
  node: DomainNode;
  /** True depth, 1 for the root. */
  level: number;
  /** The ancestor above this one; null for the root. */
  parentId: string | null;
  /** The last ancestor -- the selected node's parent -- shows what it holds. */
  childCountLabel: string | null;
  isMobile: boolean;
  onSelect: (nodeId: string) => void;
}

export const AncestorRow: ForwardRefExoticComponent<AncestorRowProps & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, AncestorRowProps>(function AncestorRow({ node, level, parentId, childCountLabel, isMobile, onSelect }: AncestorRowProps, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
  const Icon: ReturnType<typeof nodeIcon> = nodeIcon(node);
  const isRoot: boolean = level === 1;
  const leaving: boolean = useLeaving();
  const fade: MotionValue<number> = useFadeOut();
  return (
    <motion.li ref={ref} {...useRowItem()} style={{ opacity: fade }} role="none" className={cn(ITEM_CLASS, leaving && 'pointer-events-none')}>
      <TreeRow
        motionId={node.id}
        info={{ kind: 'ancestor', nodeId: node.id, parentId, selected: false, expandable: true, expanded: true }}
        level={level}
        leaving={leaving}
        expanded={true}
        testId={`tree-node-${node.id}`}
        title={node.name}
        onActivate={() => onSelect(node.id)}
        className={cn(
          'rounded transition-colors hover:bg-primary-accent/15 hover:text-foreground',
          isRoot
            ? cn(isMobile ? 'h-[34px]' : 'h-[30px]', 'px-1 gap-2 rounded-[5px] font-semibold text-foreground')
            : cn(isMobile ? 'h-[34px]' : 'h-[24px]', 'gap-1.5 text-xs pr-1 [&>svg]:size-3', childCountLabel !== null ? 'text-foreground' : 'text-muted-foreground'),
        )}
        style={isRoot ? undefined : { paddingLeft: 4 + 6 * (level - 1) }}
      >
        {isRoot ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
            <Icon className="h-[11px] w-[11px]" />
          </span>
        ) : (
          <>
            <span aria-hidden="true" className="-mt-1.5 h-2 w-2 shrink-0 rounded-bl-[3px] border-b border-l border-primary-accent/35" />
            <Icon className="h-3 w-3 shrink-0" />
          </>
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {isRoot && <span className="shrink-0 text-xs font-normal uppercase tracking-[.06em] text-muted-foreground">{rootLabel(node)}</span>}
        {childCountLabel !== null && !isRoot && <span className="shrink-0 text-xs text-muted-foreground">{childCountLabel}</span>}
      </TreeRow>
    </motion.li>
  );
});

interface MoreAncestorsRowProps {
  hidden: DomainNode[];
  /** Depth of the first hidden ancestor, for the indent. */
  level: number;
  isMobile: boolean;
  onExpand: () => void;
}

/** The folded middle of a deep stack; pressing it shows every ancestor. */
export const MoreAncestorsRow: ForwardRefExoticComponent<MoreAncestorsRowProps & RefAttributes<HTMLLIElement>> = forwardRef<HTMLLIElement, MoreAncestorsRowProps>(function MoreAncestorsRow({ hidden, level, isMobile, onExpand }: MoreAncestorsRowProps, ref: ForwardedRef<HTMLLIElement>): JSX.Element {
  const leaving: boolean = useLeaving();
  const fade: MotionValue<number> = useFadeOut();
  return (
    <motion.li ref={ref} {...useRowItem()} style={{ opacity: fade }} role="none" className={cn(ITEM_CLASS, leaving && 'pointer-events-none')}>
      <TreeRow
        motionId="tree-more-ancestors"
        // Activating it reveals this row's first hidden ancestor, and the keyboard lands there.
        info={{ kind: 'ancestor', nodeId: hidden[0].id, parentId: null, selected: false, expandable: false, expanded: false }}
        level={level}
        leaving={leaving}
        testId="tree-more-ancestors"
        title={`Show ${hidden.length} more levels: ${hidden.map((n: DomainNode): string => n.name).join(', ')}`}
        onActivate={onExpand}
        className={cn('gap-1.5 rounded text-xs text-muted-foreground hover:bg-primary-accent/15 hover:text-foreground [&>svg]:size-3', isMobile ? 'h-[34px]' : 'h-[24px]')}
        style={{ paddingLeft: 4 + 6 * (level - 1) }}
      >
        <MoreHorizontal className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{hidden.length} more</span>
      </TreeRow>
    </motion.li>
  );
});
