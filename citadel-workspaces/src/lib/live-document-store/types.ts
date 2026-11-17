/**
 * Live Document Store - Types & Constants
 *
 * Document metadata, stored document shape, and LocalDB key constants.
 */

import type { RevisionEntry } from '@/types/p2p-types';

/** Document metadata stored in LocalDB */
export interface DocumentMetadata {
  id: string;
  title: string;
  peerCid: string;
  /** CID of the document creator (authority for divergence recovery) */
  creatorCid: string;
  createdAt: number;
  updatedAt: number;
  /** Current root hash of the document */
  rootHash?: string;
  /** Current revision number */
  revision?: number;
}

/** Full document data including Yjs state */
export interface StoredDocument {
  metadata: DocumentMetadata;
  /** Yjs encoded state as array (for JSON serialization) */
  state: number[];
  /** Revision chain for divergence recovery (last N entries) */
  revisionChain?: RevisionEntry[];
}

export const DOCUMENTS_KEY_PREFIX: "live_doc" = 'live_doc';
export const DOCUMENTS_INDEX_KEY: "live_doc_index" = 'live_doc_index';
