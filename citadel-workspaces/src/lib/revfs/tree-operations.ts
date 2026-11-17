/**
 * RE-VFS Tree Operations — Barrel Re-export
 *
 * Consumers import from this module to access all tree functions.
 * Implementation is split across:
 *   - tree-queries.ts: lookups, path utilities, storage calculations
 *   - file-states.ts: file-state predicates and flips
 *   - tree-mutations.ts: mkdir, rmdir, placeFile, removeFile
 *   - tree-transforms.ts: rename, move
 *   - tree-copy-merge.ts: copy, merge
 *   - tree-sync.ts: applyRemoteOp for peer synchronization
 */

// Queries & utilities
export {
  peerTreeKey,
  legacyPairKey,
  serverTreeKey,
  makeOpId,
  now,
  cloneTree,
  normalizePath,
  parentPath,
  baseName,
  getExtension,
  createDefaultTree,
  findNode,
  pathExists,
  collectFiles,
} from './tree-queries';
export { flipFileState, flipNodeStates } from './file-states';
export { findNodeByPath } from './find-node-by-path';

// Mutations
export {
  mkdir,
  rmdir,
  placeFile,
  removeFile,
} from './tree-mutations';

// Transforms
export {
  renameNode,
  moveNode,
} from './tree-transforms';

// Copy & Merge
export {
  copyNode,
  mergeTrees,
} from './tree-copy-merge';

// Sync
export { applyRemoteOp } from './tree-sync';

// Quota accounting moved to quota-check.ts, where the number and the limit it
// feeds live together. Re-exported so existing importers are unaffected.
export { calculateStorageUsage } from './quota-check';
