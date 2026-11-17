/**
 * The folders "Move to…" offers a selection.
 */
import type { RevfsNode } from '@/types/revfs-types';
import { parentPath } from '@/lib/revfs/tree-queries';
import { uploadRefusal } from './upload-refusal';

export interface MoveDestination {
  path: string;
  /** How deep it sits, for indenting the list. */
  depth: number;
}

function folders(node: RevfsNode, depth: number, out: MoveDestination[]): void {
  if (node.type !== 'directory') return;
  out.push({ path: node.path, depth });
  const children: RevfsNode[] = [...(node.children ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) folders(child, depth + 1, out);
}

function within(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function moveDestinations(tree: RevfsNode, moving: readonly RevfsNode[]): MoveDestination[] {
  const all: MoveDestination[] = [];
  folders(tree, 0, all);
  const parents: Set<string> = new Set(moving.map((n: RevfsNode): string => parentPath(n.path)));
  const allAlreadyIn: string | null = parents.size === 1 ? [...parents][0] : null;
  return all.filter((d: MoveDestination): boolean =>
    d.path !== allAlreadyIn
    && !moving.some((n: RevfsNode): boolean => n.type === 'directory' && within(d.path, n.path))
    && uploadRefusal(d.path) === null);
}
