import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { moveTargets } from '@/lib/workspace-service/move-targets';
import type { DomainNode } from './tree-node-types';

/**
 * Choose a new parent for a node.
 *
 * A list rather than drag-and-drop, deliberately. Dragging a tree row onto
 * another is the obvious gesture and it is unreachable by keyboard, invisible
 * to a screen reader, and awkward on touch — and this is the ONLY way to
 * reorganise a workspace, so it has to work for everyone. A picker is also the
 * only shape that can show WHY a destination is unavailable, which a drop
 * target cannot.
 */
export function MoveNodeDialog({
  node,
  nodes,
  onMove,
  onClose,
}: {
  node: DomainNode | null;
  nodes: Record<string, DomainNode>;
  onMove: (nodeId: string, newParentId: string | null) => Promise<void>;
  onClose: () => void;
}): JSX.Element | null {
  // Which node's move is in flight, not a bare flag. This dialog stays mounted
  // for the sidebar's life, so a boolean set on the first move and never
  // cleared disabled every destination and Cancel on every Move after it.
  const [movingId, setMovingId] = useState<string | null>(null);
  const targets: DomainNode[] = useMemo(
    () => (node ? moveTargets(nodes, node.id) : []),
    [node, nodes],
  );

  if (!node) return null;
  const moving: boolean = movingId === node.id;

  const move = async (parentId: string | null): Promise<void> => {
    setMovingId(node.id);
    try {
      await onMove(node.id, parentId);
    } finally {
      setMovingId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {node.name}</DialogTitle>
          <DialogDescription>
            Choose where it should live. Everything inside it moves with it.
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          // Said plainly rather than shown as an empty list, which reads as a
          // loading failure. The reasons are real constraints, not a bug.
          <p role="status" className="py-2 text-sm text-muted-foreground">
            There is nowhere to move this. A node cannot go inside itself or
            anything it contains, and its destination has to accept its type.
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto py-2">
            {node.parent_id !== null && (
              <Button
                variant="ghost"
                className="w-full justify-start"
                disabled={moving}
                onClick={() => void move(null)}
              >
                Top level
              </Button>
            )}
            {targets.map((target) => (
              <Button
                key={target.id}
                variant="ghost"
                className="w-full justify-start"
                disabled={moving}
                onClick={() => void move(target.id)}
                data-testid={`move-target-${target.id}`}
              >
                {target.name}
              </Button>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={moving}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
