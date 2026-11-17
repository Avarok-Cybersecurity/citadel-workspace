/**
 * RE-VFS (Remote Encrypted Virtual File System) Types
 *
 * Domain types for the peer-pair shared virtual filesystem.
 * Both peers see an identical tree; file state icons differ by viewer CID.
 *
 * Supports two scopes:
 * - Peer: P2P shared tree (both peers see/edit the same tree)
 * - Server: Client-to-server storage (user's private server-backed tree)
 */

// ============================================================================
// Key Types (forward declarations needed for TreeKey)
// ============================================================================

/**
 * Key for one account's tree of its storage with a peer: `${mine}_${peer}`.
 * Directional on purpose; see `peerTreeKey`.
 */
export type PeerPairKey = string;

/**
 * Key for a server-scoped tree: `server_${cid}`
 */
export type ServerTreeKey = string;

// ============================================================================
// Tree Scope
// ============================================================================

/**
 * Distinguishes between P2P shared trees and server-backed trees.
 */
export enum TreeScope {
  /** P2P shared tree - synced between two peers via P2P messaging */
  Peer = 'Peer',
  /** Server-backed tree - user's private storage on the Citadel server */
  Server = 'Server',
}

/**
 * Unified tree key type for storage indexing.
 * - PeerPairKey: `${min(cidA,cidB)}_${max(cidA,cidB)}`
 * - ServerTreeKey: `server_${cid}`
 */
export type TreeKey = PeerPairKey | ServerTreeKey;

// ============================================================================
// Enums
// ============================================================================

export enum RevfsFileState {
  /** I store the encrypted blob for the peer (can't decrypt) */
  Hosted = 'Hosted',
  /** Peer stores the encrypted blob for me (downloadable) */
  Remote = 'Remote',
  /** Standard file I sent (metadata only) */
  Sent = 'Sent',
  /** Standard file I received (actual file, openable) */
  Received = 'Received',
  /** Server-stored file - encrypted on Citadel server, downloadable by owner */
  ServerStored = 'ServerStored',
}

export enum RevfsOpType {
  Mkdir = 'Mkdir',
  Rmdir = 'Rmdir',
  PlaceFile = 'PlaceFile',
  RemoveFile = 'RemoveFile',
  Rename = 'Rename',
  Move = 'Move',
  Copy = 'Copy',
  Ack = 'Ack',
  SyncRequest = 'SyncRequest',
  SyncResponse = 'SyncResponse',
  /** Ask the uploader of the file at `path` to send it; see share-on-request.ts. */
  ShareRequest = 'ShareRequest',
}

// ============================================================================
// Tree Node Types
// ============================================================================

export interface RevfsFileMetadata {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  /** Backend VFS path used for SendFile/DownloadFile/DeleteVirtualFile */
  virtualDirectory: string;
  uploadedByCid: bigint;
  thumbnail?: string;
}

export interface RevfsNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: RevfsNode[];
  fileState?: RevfsFileState;
  fileMetadata?: RevfsFileMetadata;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Operation Types
// ============================================================================

export interface RevfsOperation {
  op_id: string;
  op_type: RevfsOpType;
  path: string;
  metadata?: RevfsFileMetadata;
  /** Full tree snapshot — only present for SyncResponse */
  tree?: RevfsNode;
  /** Reference to the operation being acknowledged — only for Ack */
  ack_op_id?: string;
  /** Whether the acknowledged operation succeeded — only for Ack */
  success?: boolean;
  /** New name for Rename operation */
  newName?: string;
  /** Destination path for Move/Copy operations */
  destPath?: string;
  timestamp: number;
}

export interface RevfsPendingOp {
  operation: RevfsOperation;
  retryCount: number;
  createdAt: number;
}

// ============================================================================
// Protected Folder Constants
// ============================================================================

export const SENT_FILES_DIR: "/Sent Files" = '/Sent Files';
export const RECEIVED_FILES_DIR: "/Received Files" = '/Received Files';

export const PROTECTED_DIRS: ReadonlySet<string> = new Set([
  SENT_FILES_DIR,
  RECEIVED_FILES_DIR,
]);
