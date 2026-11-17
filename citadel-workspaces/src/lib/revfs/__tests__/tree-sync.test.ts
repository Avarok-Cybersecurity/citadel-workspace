import { describe, it, expect } from 'vitest';
import { applyRemoteOp } from '../tree-sync';
import {
  type RevfsNode,
  type RevfsOperation,
  RevfsOpType,
  PROTECTED_DIRS,
} from '@/types/revfs-types';

/**
 * applyRemoteOp is what a peer's operations do to your tree, and it had no tests
 * at all — 39 branches of it. It is also where the open question about folder
 * deletion not propagating lives, so it is worth knowing exactly which parts of
 * it are sound.
 *
 * Pure tree in, pure tree out: no mocks, no environment.
 */
const now: number = 1_700_000_000_000;
const viewer: bigint = 1n;

function dir(path: string, children: RevfsNode[] = []): RevfsNode {
  return {
    name: path === '/' ? '/' : path.split('/').filter(Boolean).pop()!,
    type: 'directory',
    path,
    children,
    createdAt: now,
    updatedAt: now,
  };
}

function file(path: string): RevfsNode {
  return {
    name: path.split('/').pop()!,
    type: 'file',
    path,
    createdAt: now,
    updatedAt: now,
  };
}

// No `as never` on the call sites below: casting the overrides silenced the type
// error that would have told me I had guessed the field names wrong (they are
// newName and destPath, not new_name/new_path). The first draft of these two
// tests failed for that reason and looked like a product bug.
function op(overrides: Partial<RevfsOperation> & { op_type: RevfsOpType }): RevfsOperation {
  return { op_id: 'op-1', path: '/', timestamp: now + 1, ...overrides };
}

const paths = (tree: RevfsNode): string[] => [
  tree.path,
  ...(tree.children ?? []).flatMap(paths),
];

describe('applyRemoteOp', () => {
  it('does not mutate the tree it is given', () => {
    const tree: RevfsNode = dir('/', [dir('/docs')]);
    const before: string = JSON.stringify(tree);

    applyRemoteOp(tree, op({ op_type: RevfsOpType.Mkdir, path: '/notes' }), viewer);

    // Callers hold onto the previous tree; mutating it in place would make the
    // "did anything change" comparisons upstream meaningless.
    expect(JSON.stringify(tree)).toBe(before);
  });

  describe('Rmdir', () => {
    it('removes the directory and everything under it', () => {
      const tree: RevfsNode = dir('/', [dir('/docs', [file('/docs/a.txt'), dir('/docs/sub')])]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Rmdir, path: '/docs' }), viewer);

      expect(paths(out)).toEqual(['/']);
    });

    it('refuses to remove a protected directory', () => {
      const protectedPath: string = [...PROTECTED_DIRS][0];
      const tree: RevfsNode = dir('/', [dir(protectedPath)]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Rmdir, path: protectedPath }), viewer);

      // A peer must not be able to delete the directories the app relies on.
      expect(paths(out)).toContain(protectedPath);
    });

    it('is a no-op for a path that is not there', () => {
      const tree: RevfsNode = dir('/', [dir('/docs')]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Rmdir, path: '/nope' }), viewer);

      expect(paths(out)).toEqual(['/', '/docs']);
    });
  });

  describe('Mkdir', () => {
    it('creates the directory under its parent', () => {
      const tree: RevfsNode = dir('/', [dir('/docs')]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Mkdir, path: '/docs/sub' }), viewer);

      expect(paths(out)).toContain('/docs/sub');
    });

    it('does not duplicate a directory that already exists', () => {
      const tree: RevfsNode = dir('/', [dir('/docs')]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Mkdir, path: '/docs' }), viewer);

      // Ops can arrive more than once; applying one twice must not fork the tree.
      expect(paths(out).filter((p) => p === '/docs')).toHaveLength(1);
    });
  });

  describe('RemoveFile', () => {
    it('removes the file', () => {
      const tree: RevfsNode = dir('/', [dir('/docs', [file('/docs/a.txt')])]);

      const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.RemoveFile, path: '/docs/a.txt' }), viewer);

      expect(paths(out)).toEqual(['/', '/docs']);
    });
  });

  describe('Rename', () => {
    it('renames a directory and re-paths its descendants', () => {
      const tree: RevfsNode = dir('/', [dir('/docs', [file('/docs/a.txt')])]);

      const out: RevfsNode = applyRemoteOp(
        tree,
        op({ op_type: RevfsOpType.Rename, path: '/docs', newName: 'papers' }),
        viewer
      );

      // A rename that moves the node but leaves children pointing at the old
      // path produces entries that can never be found again.
      expect(paths(out)).toContain('/papers');
      expect(paths(out)).toContain('/papers/a.txt');
      expect(paths(out)).not.toContain('/docs/a.txt');
    });
  });

  describe('Move', () => {
    it('moves a subtree and re-paths its descendants', () => {
      const tree: RevfsNode = dir('/', [dir('/docs', [file('/docs/a.txt')]), dir('/archive')]);

      const out: RevfsNode = applyRemoteOp(
        tree,
        // destPath is the full destination path; the implementation takes its
        // parent to find where to attach.
        op({ op_type: RevfsOpType.Move, path: '/docs', destPath: '/archive/docs' }),
        viewer
      );

      expect(paths(out)).toContain('/archive/docs');
      expect(paths(out)).toContain('/archive/docs/a.txt');
      expect(paths(out)).not.toContain('/docs');
    });
  });

  it('leaves the tree alone for an operation it does not handle', () => {
    const tree: RevfsNode = dir('/', [dir('/docs')]);

    const out: RevfsNode = applyRemoteOp(tree, op({ op_type: RevfsOpType.Ack }), viewer);

    expect(paths(out)).toEqual(['/', '/docs']);
  });
});
