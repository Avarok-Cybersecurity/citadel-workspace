/**
 * Deleting, and saying what happened.
 *
 * Split out of `useFileManagerHandlers` at the 250-line cap, mirroring
 * `useFileManagerSelectionHandlers` beside it. The two belong together: both
 * ask before destroying anything, both route a directory to `rmdir` and a file
 * to `removeFile`, and both now report the outcome either way.
 *
 * The single-item path used to announce only its failures. `revfsService.rmdir`
 * takes a per-peer serial lock, and a measured run put 7.8 seconds between the
 * confirm click and the operation even starting -- queued behind the previous
 * step's peer ack -- so a success that says nothing is a closed dialog and then
 * eight seconds of silence.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/shared/confirm-dialog';
import { describeError } from '@/lib/describe-error';
import { reportDelivery } from './report-delivery';
import type { RevfsNode } from '@/types/revfs-types';

interface DeleteDeps {
  rmdir: (path: string) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  clearSelection: () => void;
}

export function useFileManagerDeleteHandlers({ rmdir, removeFile, clearSelection }: DeleteDeps): {
  handleDelete: (node: RevfsNode) => Promise<void>;
  handleDeleteMultiple: (nodes: RevfsNode[]) => Promise<void>;
} {
  const confirm: ReturnType<typeof useConfirm> = useConfirm();

  const handleDelete: (node: RevfsNode) => Promise<void> = useCallback(async (node: RevfsNode): Promise<void> => {
    const isDirectory: boolean = node.type === 'directory';
    const ok: boolean = await confirm({
      title: isDirectory ? `Delete folder "${node.name}"?` : `Delete file "${node.name}"?`,
      description: isDirectory
        ? 'Everything inside it is deleted too. This cannot be undone.'
        : 'This cannot be undone.',
    });
    if (!ok) return;

    // Says when it lands, as deleting a SELECTION already does. A measured run
    // put 7.8s between the confirm click and `rmdir` even starting, queued
    // behind a peer ack, and silence that long reads as a click that missed.
    const removal: Promise<boolean> = isDirectory ? rmdir(node.path) : removeFile(node.path);
    removal
      .then(acknowledged => reportDelivery(acknowledged, `Deleted ${node.name}`))
      .catch(err => toast.error(`Failed to delete: ${describeError(err)}`));
  }, [rmdir, removeFile, confirm]);

  const handleDeleteMultiple: (nodes: RevfsNode[]) => Promise<void> = useCallback(async (nodes: RevfsNode[]): Promise<void> => {
    const count: number = nodes.length;
    const ok: boolean = await confirm({
      title: `Delete ${count} item${count !== 1 ? 's' : ''}?`,
      description: 'Any folders in the selection are deleted with their contents. This cannot be undone.',
    });
    if (!ok) return;
    Promise.all(nodes.map(node => node.type === 'directory' ? rmdir(node.path) : removeFile(node.path)))
      .then(acknowledgements => {
        reportDelivery(acknowledgements.every(Boolean), `Deleted ${count} item${count !== 1 ? 's' : ''}`);
        clearSelection();
      })
      .catch(err => toast.error(`Failed to delete: ${describeError(err)}`));
  }, [rmdir, removeFile, clearSelection, confirm]);

  return { handleDelete, handleDeleteMultiple };
}
