/**
 * What the address bar shows and accepts, as pure functions of the tree.
 *
 * A typed path resolves one segment at a time: the folder spelled exactly as
 * typed if there is one, otherwise the one that matches ignoring case. Two
 * folders differing only in case are both reachable that way, and nobody has to
 * remember whether it was "Received files" or "Received Files".
 */
import type { RevfsNode } from '@/types/revfs-types';
import { normalizePath } from '@/lib/revfs/tree-queries';

export type PathResolution = { ok: true; path: string } | { ok: false };

export interface Crumb {
  name: string;
  path: string;
}

/** What the top level is called in the crumbs. */
export const ROOT_LABEL = 'Root' as const;

function childFolder(parent: RevfsNode, segment: string): RevfsNode | null {
  const folders: RevfsNode[] = (parent.children ?? []).filter((n: RevfsNode): boolean => n.type === 'directory');
  const exact: RevfsNode | undefined = folders.find((n: RevfsNode): boolean => n.name === segment);
  if (exact) return exact;
  const folded: string = segment.toLowerCase();
  return folders.find((n: RevfsNode): boolean => n.name.toLowerCase() === folded) ?? null;
}

export function resolveTypedPath(tree: RevfsNode, typed: string): PathResolution {
  const segments: string[] = normalizePath(typed.trim()).split('/').filter(Boolean);
  let at: RevfsNode = tree;
  for (const segment of segments) {
    const next: RevfsNode | null = childFolder(at, segment);
    if (next === null) return { ok: false };
    at = next;
  }
  return { ok: true, path: at.path };
}

export function crumbsOf(path: string): Crumb[] {
  const segments: string[] = normalizePath(path).split('/').filter(Boolean);
  return [
    { name: ROOT_LABEL, path: '/' },
    ...segments.map((name: string, i: number): Crumb => ({ name, path: '/' + segments.slice(0, i + 1).join('/') })),
  ];
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function itemCountLabel(children: readonly RevfsNode[]): string {
  const folders: number = children.filter((n: RevfsNode): boolean => n.type === 'directory').length;
  const files: number = children.length - folders;
  if (folders === 0 && files === 0) return 'Empty';
  if (files === 0) return counted(folders, 'folder', 'folders');
  if (folders === 0) return counted(files, 'file', 'files');
  return `${counted(folders, 'folder', 'folders')}, ${counted(files, 'file', 'files')}`;
}
