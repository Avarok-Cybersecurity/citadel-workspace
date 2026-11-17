/**
 * RE-VFS SBIO Intent Types
 *
 * All I/O operations the RE-VFS service needs are expressed as intents.
 * The I/O router (revfs-io.ts) executes them, keeping business logic pure.
 *
 * Supports both P2P (peer_cid is bigint) and Server (peer_cid is null) scopes.
 */

import type {
  RevfsNode,
  RevfsOperation,
  RevfsPendingOp,
  TreeKey,
} from './revfs-types';

export type RevfsIntent =
  // P2P-only: send operation to peer via P2P messaging
  | { type: 'send-revfs-op'; peerCid: bigint; operation: RevfsOperation }
  // Tree persistence: uses TreeKey (either PeerPairKey or ServerTreeKey)
  | { type: 'persist-tree'; treeKey: TreeKey; tree: RevfsNode }
  | { type: 'load-tree'; treeKey: TreeKey }
  // Pending ops: uses TreeKey (either PeerPairKey or ServerTreeKey)
  | { type: 'persist-pending-ops'; treeKey: TreeKey; ops: RevfsPendingOp[] }
  | { type: 'load-pending-ops'; treeKey: TreeKey }
  // Backend file ops: peerCid is bigint for P2P, null for server storage
  /**
   * `content` is the file's actual bytes.
   *
   * This used to carry `source: string` — and the string passed was a tree
   * DIRECTORY PATH, not a filesystem path and not data. The backend field is
   * `FileSource`, an externally-tagged enum, and the WASM client deserializes
   * strictly, so the request was rejected in the browser before it was ever
   * sent. Nothing reached the internal service and nothing was logged there.
   */
  | {
      type: 'backend-send-file';
      cid: bigint;
      peerCid: bigint | null;
      fileName: string;
      content: Uint8Array;
      virtualDir: string;
    }
  | { type: 'backend-download-file'; cid: bigint; peerCid: bigint | null; virtualDir: string }
  | { type: 'backend-delete-file'; cid: bigint; peerCid: bigint | null; virtualDir: string }
  // Read a pulled file's bytes back from the agent, one chunk (ReadPulledFileChunk).
  | { type: 'backend-read-pulled-chunk'; cid: bigint; peerCid: bigint | null; virtualDir: string; offset: bigint; maxLen: number };

/** One chunk of a file the agent pulled: `offset + data.length === totalSize` at the end. */
export interface PulledChunk {
  readonly totalSize: bigint;
  readonly offset: bigint;
  readonly data: Uint8Array;
}

/** The agent's answer to one ReadPulledFileChunk: a chunk, or why there is none. */
export type ReadChunkAnswer =
  | { readonly kind: 'chunk'; readonly chunk: PulledChunk }
  | { readonly kind: 'failed'; readonly message: string };

export type RevfsIntentResult =
  | { type: 'send-revfs-op'; success: boolean }
  | { type: 'persist-tree'; success: boolean }
  // `tree: null` means the tree is genuinely absent -- a first run. `unreadable`
  // means storage failed to answer, which is NOT the same thing and must never
  // be treated as an empty tree: the caller would write a default over a tree
  // that is still on disk.
  | { type: 'load-tree'; tree: RevfsNode | null; unreadable?: boolean }
  | { type: 'persist-pending-ops'; success: boolean }
  | { type: 'load-pending-ops'; ops: RevfsPendingOp[] }
  | { type: 'backend-send-file'; success: true; virtualDir?: string }
  /** `reason`: what refused or lost the upload, in words a person can act on (the agent's own when it gave one). */
  | { type: 'backend-send-file'; success: false; reason: string }
  | { type: 'backend-download-file'; success: boolean; downloadPath?: string }
  | { type: 'backend-delete-file'; success: boolean }
  | { type: 'backend-read-pulled-chunk'; answer: ReadChunkAnswer };
