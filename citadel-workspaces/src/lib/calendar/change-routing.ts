/**
 * Which of a pane's sources a change touches (design 3.3.1, 3.5): a kernel `StorageChanged`, or a
 * `cal` topic message, which says only `{ node, key }` and so cannot tell an official event from
 * a member-posted one. A change to this node's own keys re-reads that source; a change to an
 * event on an ancestor re-reads what this node inherits (the projection is reconciled with its
 * origin); a change to an event below re-reads what is pulled up. Anything else touches nothing.
 */
import type { StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import type { CalChange } from './generated/CalChange';
import { INHERIT_PREFIX } from './read-propagated';
import { EVENT_PREFIX, sourceOfChange, type ReadSource } from './read-sources';
import type { EntrySource } from './store';

/** Where a pane is: its node, its chain (the node, then its ancestors) and the pages below it. */
export interface Around {
  readonly node: string;
  readonly chain: readonly string[];
  readonly below: ReadonlySet<string>;
}

type Kind = 'node' | 'authored' | 'either';

function sourcesAt(node: string, key: string, around: Around, kind: Kind): EntrySource[] {
  if (node === around.node) {
    if (key.startsWith(INHERIT_PREFIX) && kind !== 'authored') return ['inherited'];
    if (!key.startsWith(EVENT_PREFIX)) return [];
    return kind === 'either' ? ['node', 'authored'] : [kind];
  }
  if (!key.startsWith(EVENT_PREFIX)) return [];
  if (around.chain.includes(node) && kind !== 'authored') return ['inherited'];
  if (around.below.has(node)) return ['up_pulled'];
  return [];
}

export function sourcesOfStorageChange(change: StorageChange, around: Around): EntrySource[] {
  const own: ReadSource | null = sourceOfChange(change, around.node);
  if (own !== null) return [own];
  const { backend, key } = change;
  if (typeof backend !== 'object') return [];
  if ('node' in backend) return sourcesAt(backend.node.node_id, key, around, 'node');
  if ('node_authored' in backend) return sourcesAt(backend.node_authored.node_id, key, around, 'authored');
  return [];
}

/** Whether the kernel's change is to a key under `prefix` in `node`'s own store (its editors' keys). */
export function isNodeKeyChange(change: StorageChange, node: string, prefix: string): boolean {
  const { backend, key } = change;
  return typeof backend === 'object' && 'node' in backend && backend.node.node_id === node && key.startsWith(prefix);
}

export function sourcesOfTopicChange(change: CalChange, around: Around): EntrySource[] {
  return sourcesAt(change.node, change.key, around, 'either');
}
