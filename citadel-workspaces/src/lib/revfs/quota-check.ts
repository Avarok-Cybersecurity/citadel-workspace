/**
 * The quota: how much is used, and whether an upload fits.
 *
 * The two halves live together because each is meaningless without the other —
 * a check against a total that counts the wrong things is not a check, and both
 * of this module's defects were exactly that. `calculateStorageUsage` moved here
 * from `tree-queries`, where it sat among path helpers and tree walks and was
 * read as one more traversal rather than as the number a limit is enforced
 * against.
 */
import { RevfsFileState, TreeScope } from '@/types/revfs-types';
import type { RevfsNode } from '@/types/revfs-types';

export function calculateStorageUsage(tree: RevfsNode, scope: TreeScope): number {
  let total: number = 0;
  /**
   * Byte keys already counted.
   *
   * A copy shares its original's blob — `tree-byte-refs` exists precisely
   * because several nodes can point at one `virtualDirectory`, and
   * `removeFileFromPeer` refuses to delete the bytes until the last reference
   * goes. Summing per NODE therefore charged a 10 MB file twice for a copy that
   * consumed nothing, and the quota it gates is real storage, not references.
   */
  const counted: Set<string> = new Set<string>();

  const traverse = (node: RevfsNode): void => {
    if (node.type === 'file' && node.fileMetadata) {
      const key: string = node.fileMetadata.virtualDirectory;
      const alreadyCounted: boolean = counted.has(key);
      if (scope === TreeScope.Server && node.fileState === RevfsFileState.ServerStored) {
        if (!alreadyCounted) {
          counted.add(key);
          total += node.fileMetadata.fileSize;
        }
      // Quota gates uploads (`storageQuota - storageUsed`), so "used" means what
      // I have PUT somewhere — which, with the Hosted/Remote inversion fixed, is
      // Remote. Counting Hosted here would meter what peers store on my disk.
      } else if (scope === TreeScope.Peer && node.fileState === RevfsFileState.Remote) {
        if (!alreadyCounted) {
          counted.add(key);
          total += node.fileMetadata.fileSize;
        }
      }
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  traverse(tree);
  return total;
}

/**
 * Whether an upload fits, counting the uploads already in the air.
 *
 * `storageUsed` is derived from the tree, and the tree only grows once an upload
 * has landed. So a second drop started before the first one's write completes is
 * measured against a total that does not include it — two 60% drops both pass a
 * check against an 80% quota, and the limit is exceeded by exactly the amount
 * the user was told there was room for.
 *
 * The window is not small: an upload is a network round trip to the peer or the
 * server, and dropping a second batch while the first is still going is the
 * ordinary way people use a file manager.
 *
 * Kept pure and separate from the handler so the arithmetic can be tested
 * without a tree, a hook or a drop event.
 */
export interface QuotaRequest {
  /** Bytes the tree already accounts for. */
  used: number;
  /** The ceiling. */
  quota: number;
  /** Bytes of uploads started and not yet landed in the tree. */
  inFlight: number;
  /** Bytes this attempt would add. */
  incoming: number;
}

/** How much room is left, once uploads in the air are counted. */
export function remainingQuota(request: Omit<QuotaRequest, 'incoming'>): number {
  return Math.max(0, request.quota - request.used - request.inFlight);
}

export function wouldExceedQuota(request: QuotaRequest): boolean {
  return request.incoming > remainingQuota(request);
}
