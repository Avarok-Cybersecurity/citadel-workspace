/**
 * The confirmation behind a node's Delete, split out of TreeNodesSection.
 *
 * Closed only on success. It used to close in a `finally`, so a failed delete
 * looked exactly like a successful one -- the confirmation disappeared while
 * the node stayed in the tree. That is worse than silence: it reports the
 * opposite of what happened. A failure stays open and says why, in the words
 * the server gave.
 */
import { useCallback, useState } from 'react';
import { debugLog } from '@/lib/debug-config';
import { describeFailure } from '@/lib/failure-message';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import { ConfirmDeleteDialog } from '@/components/shared/ConfirmDeleteDialog';
import { descendantCount } from './tree-node-utils';
import type { DomainNode } from './tree-node-types';

interface NodeDeleteDialogProps {
  node: DomainNode | null;
  nodes: readonly DomainNode[];
  onDelete: (node: DomainNode) => Promise<void> | void;
  onClose: () => void;
}

export function NodeDeleteDialog({ node, nodes, onDelete, onClose }: NodeDeleteDialogProps): JSX.Element {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inside: number = node ? descendantCount(nodes, node.id) : 0;

  const confirmDelete: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!node) return;
    setDeleteError(null);
    try {
      await onDelete(node);
      onClose();
    } catch (error) {
      debugLog('NodeDeleteDialog', 'Error deleting node:', error);
      setDeleteError(describeFailure(error, 'Could not delete this node. It may need permissions you do not have.'));
    }
  }, [node, onDelete, onClose]);

  return (
    <ConfirmDeleteDialog
      open={node !== null}
      onOpenChange={() => {
        onClose();
        setDeleteError(null);
      }}
      title={`Delete ${node ? getEntityTypeString(node.entity_type) : 'Node'}`}
      description={
        <>
          Are you sure you want to delete &quot;{node?.name}&quot;? This
          action cannot be undone.
          {inside > 0 && (
            <span className="block mt-2 text-warning-emphasis">
              Warning: This will also delete {inside}{' '}
              space(s) inside it and all their content.
            </span>
          )}
          {deleteError && (
            <span role="alert" className="block mt-3 text-destructive-emphasis">
              {deleteError}
            </span>
          )}
        </>
      }
      onConfirm={confirmDelete}
    />
  );
}
