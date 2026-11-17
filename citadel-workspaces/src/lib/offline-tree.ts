/**
 * The last-known workspace tree, for opening a document while the server is out of reach:
 * what is kept (every node the server last listed, and when), how a kept value is read back,
 * and when it may be shown. Pure: the record is read and written through the local-record
 * seam (lib/document-replica-cache.ts), which sign-out sweeps.
 *
 * Shown only while the agent says it is bringing this session's server link back
 * (reconnectingTo), never while the link is up: a live tree always wins, and the kept one is
 * labelled with its time so it never passes for live.
 */
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

export interface CachedWorkspaceTree {
  /** When the server's answer this copies arrived, ms since the epoch. */
  readonly savedAt: number;
  readonly nodes: Readonly<Record<string, DomainNode>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A kept value read back: null when there is none; an error when it is not what this client writes. */
export function readCachedTree(value: unknown): CachedWorkspaceTree | null {
  if (value === undefined) return null;
  if (!isRecord(value) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || !isRecord(value.nodes)) {
    throw new Error('the kept workspace tree is not in the shape this client writes');
  }
  for (const [id, node] of Object.entries(value.nodes)) {
    if (!isRecord(node) || node.id !== id || typeof node.name !== 'string' || !Array.isArray(node.metadata)) {
      throw new Error(`the kept workspace tree holds a node ${id} that is not one`);
    }
  }
  return { savedAt: value.savedAt, nodes: value.nodes as Record<string, DomainNode> };
}

/** What a server's node list is kept as; null for an empty list, which is never kept over a fuller one. */
export function treeToKeep(nodes: Readonly<Record<string, DomainNode>>, now: number): CachedWorkspaceTree | null {
  return Object.keys(nodes).length === 0 ? null : { savedAt: now, nodes: { ...nodes } };
}

export type ShownNode =
  | { readonly kind: 'live'; readonly node: DomainNode }
  | { readonly kind: 'kept'; readonly node: DomainNode; readonly savedAt: number }
  | { readonly kind: 'none' };

/**
 * The node a view shows: the live one when the server has listed it; the kept one only while
 * the link is down; otherwise none (still loading, or gone).
 */
export function shownNode(nodeId: string, live: Readonly<Record<string, DomainNode>>, linkDown: boolean, kept: CachedWorkspaceTree | null): ShownNode {
  const fresh: DomainNode | undefined = live[nodeId];
  if (fresh !== undefined) return { kind: 'live', node: fresh };
  const old: DomainNode | undefined = linkDown && kept !== null ? kept.nodes[nodeId] : undefined;
  return old === undefined || kept === null ? { kind: 'none' } : { kind: 'kept', node: old, savedAt: kept.savedAt };
}

/** The notice over a document opened from the kept tree. */
export function offlineNotice(savedAt: number, format: (ms: number) => string): string {
  return `Offline — showing the tree as of ${format(savedAt)}.`;
}
