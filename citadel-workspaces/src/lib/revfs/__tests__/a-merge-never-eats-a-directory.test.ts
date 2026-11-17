/**
 * Merging must never turn a directory into a file and lose its contents.
 *
 * `mergeTrees` is a union merge everywhere except its first line:
 *
 *   if (local.type === 'file' || remote.type === 'file') {
 *     return local.updatedAt >= remote.updatedAt ? clone(local) : clone(remote);
 *   }
 *
 * When both sides are files that is last-write-wins, which is the intent. When
 * one side is a DIRECTORY and the other a file at the same path, it is a
 * timestamp deciding whether a whole subtree survives — and the loser is not a
 * competing version of the same thing, it is everything underneath it.
 *
 * A peer that is a moment behind, or a stale op replayed out of order, is
 * enough. Nothing in the tree records that the children ever existed, so there
 * is no recovering them and no sign anything was lost.
 *
 * The rest of this file's design says the same thing in its own comment:
 * "deletions are handled by explicit RemoveFile/RemoveDir operations, not
 * inferred from missing children". A directory vanishing because a file
 * arrived at its path is a deletion nobody asked for.
 */
import { describe, it, expect } from 'vitest';
import { mergeTrees } from '../tree-copy-merge';
import type { RevfsNode } from '@/types/revfs-types';

function dir(path: string, updatedAt: number, children: RevfsNode[]): RevfsNode {
  // 'directory', which is what the app actually writes. The first draft of this
  // test said 'dir' -- a value nothing produces -- and both the test and the
  // fix agreed on it, so the test passed while the fix would have been inert in
  // production. Typing the helper's return as RevfsNode is what caught it.
  return { path, name: path.split('/').pop() ?? '', type: 'directory', createdAt: 0, updatedAt, children };
}
function file(path: string, updatedAt: number): RevfsNode {
  return { path, name: path.split('/').pop() ?? '', type: 'file', createdAt: 0, updatedAt };
}

describe('merging a directory with a file at the same path', () => {
  it('keeps the directory and its children, whatever the timestamps say', () => {
    const local: RevfsNode = dir('/docs', 100, [file('/docs/a.txt', 100), file('/docs/b.txt', 100)]);
    const remote: RevfsNode = file('/docs', 999);

    const merged: RevfsNode = mergeTrees(local, remote);

    expect(merged.type, 'a newer file at a directory’s path must not replace it').toBe('directory');
    expect((merged.children ?? []).map((c: RevfsNode) => c.path).sort()).toEqual([
      '/docs/a.txt',
      '/docs/b.txt',
    ]);
  });

  it('keeps it the other way round too', () => {
    const local: RevfsNode = file('/docs', 999);
    const remote: RevfsNode = dir('/docs', 100, [file('/docs/a.txt', 100)]);

    const merged: RevfsNode = mergeTrees(local, remote);

    expect(merged.type).toBe('directory');
    expect((merged.children ?? []).map((c: RevfsNode) => c.path)).toEqual(['/docs/a.txt']);
  });

  it('still resolves two files by last write, which is the intent', () => {
    // The positive control. Without it, "never lose the directory" could be
    // satisfied by a merge that had stopped choosing between file versions.
    const older: RevfsNode = file('/notes.txt', 100);
    const newer: RevfsNode = file('/notes.txt', 200);

    expect(mergeTrees(older, newer).updatedAt).toBe(200);
    expect(mergeTrees(newer, older).updatedAt).toBe(200);
  });

  it('still unions two directories', () => {
    const local: RevfsNode = dir('/d', 100, [file('/d/a', 1)]);
    const remote: RevfsNode = dir('/d', 200, [file('/d/b', 2)]);

    const merged: RevfsNode = mergeTrees(local, remote);
    expect((merged.children ?? []).map((c: RevfsNode) => c.path).sort()).toEqual(['/d/a', '/d/b']);
  });
});
