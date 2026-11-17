/**
 * "Move to…" lists the folders a selection can go to: not into itself or
 * anything under it, not where it already is, and not Sent Files, which lists
 * what you sent in chat and refuses anything else.
 */
import { describe, it, expect } from 'vitest';
import type { RevfsNode } from '@/types/revfs-types';
import { moveDestinations } from '../move-destinations';

function dir(path: string, children: RevfsNode[] = []): RevfsNode {
  return { name: path.split('/').pop() ?? '', path, type: 'directory', children, createdAt: 1, updatedAt: 1 };
}
const file = (path: string): RevfsNode => ({ name: path.split('/').pop() ?? '', path, type: 'file', createdAt: 1, updatedAt: 1 });

const report: RevfsNode = file('/Docs/report.pdf');
const archive: RevfsNode = dir('/Docs/Archive', [dir('/Docs/Archive/2025')]);
const docs: RevfsNode = dir('/Docs', [report, archive]);
const tree: RevfsNode = dir('/', [dir('/Sent Files'), dir('/Received Files'), docs, dir('/Team')]);
tree.path = '/';

describe('where a selection can move to', () => {
  it('is every other folder, the top level included', () => {
    expect(moveDestinations(tree, [report]).map((d) => d.path)).toEqual(['/', '/Docs/Archive', '/Docs/Archive/2025', '/Received Files', '/Team']);
  });

  it('is never into the folder being moved or below it', () => {
    const paths: string[] = moveDestinations(tree, [archive]).map((d) => d.path);
    expect(paths).not.toContain('/Docs/Archive');
    expect(paths).not.toContain('/Docs/Archive/2025');
    expect(paths).not.toContain('/Docs');
  });

  it('keeps a folder that only some of the selection is already in', () => {
    const elsewhere: RevfsNode = file('/Team/x.pdf');
    expect(moveDestinations(tree, [report, elsewhere]).map((d) => d.path)).toContain('/Docs');
  });

  it('is never Sent Files', () => {
    expect(moveDestinations(tree, [report]).map((d) => d.path)).not.toContain('/Sent Files');
  });
});
