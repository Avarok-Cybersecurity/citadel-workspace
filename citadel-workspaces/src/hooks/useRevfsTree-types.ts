/**
 * Types for useRevfsTree and useServerRevfsTree hooks.
 */

import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import type { PulledChunk } from '@/types/revfs-intents';
import type { StorageOffer } from '@/lib/revfs/storage-offer';
import type { ServerFeatureRefusal } from 'citadel-workspace-client-ts';

/** A chunk of a file this storage's last pull of it left with the agent (ReadPulledFileChunk). */
export type ReadPulledChunk = (filePath: string, offset: bigint, maxLen: number) => Promise<PulledChunk>;

/** Default storage quota: 100 MB */
export const DEFAULT_QUOTA_BYTES: number = 100 * 1024 * 1024;

/**
 * A mutating operation answers whether the change reached its destination --
 * the peer acknowledged it, or the server accepted it. NOT whether the local
 * tree changed, which it did either way and which is persisted regardless.
 *
 * These were `Promise<void>`, and `sendAndAwaitAck` grew a boolean return so
 * that an unacknowledged operation would stop being invisible. That flag was
 * discarded by every peer op, so the file manager announced folders created and
 * files removed on peers that had never heard of them. A `void` here makes the
 * honest report structurally impossible.
 */
export interface UseRevfsTreeResult {
  tree: RevfsNode | null;
  loading: boolean;
  error: string | null;
  /** Storage currently used by hosted files (bytes) */
  storageUsed: number;
  /** Storage quota limit (bytes) */
  storageQuota: number;
  /** Whether this peer's storage takes files (the person's own setting for the peer). */
  storageOffer: StorageOffer;
  mkdir: (path: string) => Promise<boolean>;
  rmdir: (path: string) => Promise<boolean>;
  uploadFile: (dirPath: string, fileName: string, metadata: RevfsFileMetadata, content: Uint8Array) => Promise<boolean>;
  downloadFile: (filePath: string) => Promise<string | undefined>;
  readPulledChunk: ReadPulledChunk;
  removeFile: (filePath: string) => Promise<boolean>;
  /** Rename a file or directory */
  rename: (path: string, newName: string) => Promise<boolean>;
  /** Move a file or directory to a new parent directory */
  move: (sourcePath: string, destParentPath: string) => Promise<boolean>;
  /** Copy a file or directory to a new parent directory */
  copy: (sourcePath: string, destParentPath: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  /** Paths whose change the peer has not acknowledged yet (never any for the server). */
  pendingPaths: ReadonlySet<string>;
}

export interface UseServerRevfsTreeResult {
  tree: RevfsNode | null;
  loading: boolean;
  error: string | null;
  /** Storage currently used by server-stored files (bytes) */
  storageUsed: number;
  /** Storage quota limit (bytes) */
  storageQuota: number;
  /** Whether the server stores files: checking until GetServerCapabilities answers, never assumed. */
  storageOffer: StorageOffer;
  mkdir: (path: string) => Promise<boolean>;
  rmdir: (path: string) => Promise<boolean>;
  uploadFile: (dirPath: string, fileName: string, metadata: RevfsFileMetadata, content: Uint8Array) => Promise<boolean>;
  downloadFile: (filePath: string) => Promise<string | undefined>;
  readPulledChunk: ReadPulledChunk;
  removeFile: (filePath: string) => Promise<boolean>;
  /** Rename a file or directory */
  rename: (path: string, newName: string) => Promise<boolean>;
  /** Move a file or directory to a new parent directory */
  move: (sourcePath: string, destParentPath: string) => Promise<boolean>;
  /** Copy a file or directory to a new parent directory */
  copy: (sourcePath: string, destParentPath: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  /** Paths whose change the peer has not acknowledged yet (never any for the server). */
  pendingPaths: ReadonlySet<string>;
}

/** Server capabilities state */
export interface ServerCapabilities {
  allowServerFileTransfer: boolean;
  allowServerRevfsStorage: boolean;
  maxFileTransferSizeMb: number;
  revfsStorageQuotaMb: number;
  /** Why the server stores no files, when it says; null when storage is on or it gave no reason. */
  revfsStorageRefusal: ServerFeatureRefusal | null;
}

/** The server acknowledges by answering the request itself; nothing is left pending. */
export const NOTHING_PENDING: ReadonlySet<string> = new Set<string>();
