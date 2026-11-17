/**
 * cloneTree ran every tree through JSON.stringify with a bigint->string
 * replacer, so `uploadedByCid` — typed bigint — became a string after the first
 * mutation. Every mutation clones, so no stored tree escaped it, and the
 * corruption persisted into IndexedDB.
 */
import { describe, it, expect } from 'vitest';
import { cloneTree, createDefaultTree } from '../tree-queries';
import { placeFile, mkdir } from '../tree-mutations';
import type { RevfsFileMetadata, RevfsNode } from '@/types/revfs-types';

const CID: bigint = 18446744073709551615n; // u64 max — also beyond Number.MAX_SAFE_INTEGER

function meta(): RevfsFileMetadata {
  return {
    fileId: 'f1', fileName: 'a.txt', fileSize: 1, fileType: 'text/plain',
    virtualDirectory: '/a.txt', uploadedByCid: CID,
  };
}

describe('cloneTree', () => {
  it('keeps a bigint CID a bigint', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = placeFile(tree, '/a.txt', meta(), CID);

    const cloned: RevfsNode = cloneTree(tree);
    const file: RevfsNode | undefined = cloned.children?.find((c): boolean => c.name === 'a.txt');

    expect(typeof file?.fileMetadata?.uploadedByCid).toBe('bigint');
    expect(file?.fileMetadata?.uploadedByCid).toBe(CID);
  });

  it('survives a CID beyond Number.MAX_SAFE_INTEGER without losing precision', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = placeFile(tree, '/a.txt', meta(), CID);

    const file: RevfsNode | undefined = cloneTree(tree).children?.find((c): boolean => c.name === 'a.txt');

    expect(file?.fileMetadata?.uploadedByCid).toBe(18446744073709551615n);
  });

  it('still keeps the CID a bigint after a mutation, which clones internally', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = placeFile(tree, '/a.txt', meta(), CID);
    // Every mutation clones — this is where the corruption used to enter.
    [tree] = mkdir(tree, '/later');

    const file: RevfsNode | undefined = tree.children?.find((c): boolean => c.name === 'a.txt');

    expect(typeof file?.fileMetadata?.uploadedByCid).toBe('bigint');
  });

  it('produces an independent copy, not a shared reference', () => {
    let tree: RevfsNode = createDefaultTree();
    [tree] = mkdir(tree, '/dir');

    const cloned: RevfsNode = cloneTree(tree);
    const clonedDir: RevfsNode = cloned.children!.find((c): boolean => c.name === 'dir')!;
    clonedDir.name = 'changed';

    // The original must be untouched — a shallow copy here would corrupt the
    // tree the caller still holds.
    expect(tree.children!.some((c) => c.name === 'dir')).toBe(true);
    expect(tree.children!.some((c) => c.name === 'changed')).toBe(false);
  });
});
