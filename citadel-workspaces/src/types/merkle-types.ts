/**
 * Merkle Tree Types for P2P Sync
 *
 * Types for Merkle tree-based document synchronization.
 */

/**
 * Serialized chunk for network transmission
 */
export interface SerializedChunk {
  index: number;
  hash: string;
  data: number[]; // Uint8Array as array for JSON
}

/**
 * Merkle proof for verification and comparison
 */
export interface MerkleProof {
  rootHash: string;
  leafCount: number;
  treeHeight: number;
  /** Node hashes by level (0 = root) */
  levelHashes: string[][];
  /** Optional chunks for targeted sync */
  chunks?: SerializedChunk[];
}

/**
 * YJS-specific Merkle proof with document metadata
 */
export interface YjsMerkleProof extends MerkleProof {
  documentId: string;
  creatorCid: string | null;
  revision: number;
}

/**
 * Revision entry for hash chain
 */
export interface RevisionEntry {
  revision: number;
  rootHash: string;
  timestamp: number;
  prevHash?: string;
}
