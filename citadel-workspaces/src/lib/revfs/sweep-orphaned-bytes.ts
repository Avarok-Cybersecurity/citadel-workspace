/**
 * Deleting the bytes a directory removal just orphaned.
 *
 * Split out of `revfs-dir-ops.ts` at the 250-line cap. It is the one piece both
 * `peerRmdir` and `serverRmdir` call and neither owns, so it cuts cleanly.
 */
import { debugLog } from '@/lib/debug-config';
import { countByteKeyRefs } from './tree-byte-refs';
import type { RevfsIO } from './revfs-io';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsNode } from '@/types/revfs-types';

/**
 * Delete the bytes of files that a directory removal just orphaned.
 *
 * A directory is a tree-only concept: the backend stores files keyed by virtual
 * path and knows nothing about the folder above them. So removing a folder from
 * the tree without this leaves every blob under it on disk forever —
 * unreferenced, unreclaimable, and still consuming the real quota even though
 * the storage bar stops counting it.
 */
export async function sweepOrphanedBytes(
  io: RevfsIO,
  myCid: bigint,
  peerCid: bigint | null,
  orphaned: RevfsNode[],
  remainingTree: RevfsNode,
  storageLabel: string,
): Promise<void> {
  const undeleted: string[] = [];
  // Copies share their original's byte key (tree-byte-refs.ts): a blob still
  // referenced OUTSIDE the removed folder must survive the sweep — rmdir of a
  // folder holding only a copy used to destroy the original's bytes — and two
  // copies INSIDE it are one blob, one delete.
  const sweptKeys: Set<string> = new Set<string>();
  for (const file of orphaned) {
    if (!file.fileMetadata) {
      // Nothing identifies this file to the backend, so it cannot be deleted
      // there. Say so rather than dropping it silently and reporting success.
      debugLog('RevfsDirOps', `rmdir: no metadata for ${file.path}, cannot delete remotely`);
      continue;
    }
    const byteKey: string = file.fileMetadata.virtualDirectory;
    if (byteKey !== '') {
      if (sweptKeys.has(byteKey)) continue;
      sweptKeys.add(byteKey);
      if (countByteKeyRefs(remainingTree, byteKey) > 0) continue;
    }
    const deleted: RevfsIntentResult = await io.execute({
      type: 'backend-delete-file',
      cid: myCid,
      peerCid,
      // The upload-time key. See uploadFileToServer — a renamed file's bytes
      // stay where they were written, so node.path is the wrong thing here.
      virtualDir: file.fileMetadata.virtualDirectory,
    });

    // Collected rather than thrown per file: the directory is already gone from
    // the tree, so aborting halfway would leave the remaining files both
    // undeleted AND unreported. The user is told which ones survived.
    if (deleted.type !== 'backend-delete-file' || !deleted.success) {
      undeleted.push(file.path);
    }
  }

  if (undeleted.length > 0) {
    throw new Error(
      `The folder was removed, but ${undeleted.length} file(s) could not be deleted from ` +
        `${storageLabel} and are still using space: ${undeleted.join(', ')}`
    );
  }
}
