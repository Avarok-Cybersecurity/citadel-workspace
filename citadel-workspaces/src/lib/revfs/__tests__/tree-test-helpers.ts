/**
 * Shared test helpers for tree-operations tests.
 */

import type { RevfsFileMetadata } from '@/types/revfs-types';

export const CID_A: bigint = 100n;
export const CID_B: bigint = 200n;

export function makeMeta(overrides?: Partial<RevfsFileMetadata>): RevfsFileMetadata {
  return {
    fileId: 'file-1',
    fileName: 'test.pdf',
    fileSize: 1024,
    fileType: 'application/pdf',
    virtualDirectory: '/vfs/test',
    uploadedByCid: CID_A,
    ...overrides,
  };
}
