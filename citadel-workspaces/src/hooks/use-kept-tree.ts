/**
 * This account's last-known workspace tree, read from this device only while the server link
 * is down (the agent's reconnectingTo), and held as one of five answers: still reading, kept,
 * none kept, kept but sealed with no key here (locked), or kept but unreadable (said, never
 * treated as none). The read goes through the
 * caller's port, so the rule is tested against the real seam and the view against a stand-in.
 *
 * The account is the tab's at the moment of each read and write (readTabIdentity), never one
 * captured at mount: the handler that keeps the tree mounts before sign-in, and an account read
 * then was none, so no tree was ever kept (CI run 39194273768).
 */
import { useEffect, useState } from 'react';
import type { CachedWorkspaceTree } from '@/lib/offline-tree';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { readTabIdentity } from '@/hooks/use-tab-identity';
import type { TabIdentity } from '@/lib/tab-identity';

export type KeptTree =
  | { readonly kind: 'unread' }
  | { readonly kind: 'kept'; readonly tree: CachedWorkspaceTree }
  | { readonly kind: 'none' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'unreadable'; readonly message: string };

/** The tab's account's kept tree; null when none is kept or no account is signed in here; 'locked' when it is sealed with no key here. */
export type LoadKeptTree = () => Promise<CachedWorkspaceTree | null | 'locked'>;

const UNREAD: KeptTree = { kind: 'unread' };

export function useKeptTree(load: LoadKeptTree, linkDown: boolean): KeptTree {
  const [kept, setKept] = useState<KeptTree>(UNREAD);
  useEffect((): (() => void) | undefined => {
    setKept(UNREAD);
    if (!linkDown) return undefined;
    let live: boolean = true;
    load().then(
      (tree: CachedWorkspaceTree | null | 'locked'): void => {
        if (live) setKept(tree === null ? { kind: 'none' } : tree === 'locked' ? { kind: 'locked' } : { kind: 'kept', tree });
      },
      (error: unknown): void => {
        const message: string = error instanceof Error ? error.message : String(error);
        console.warn('[useKeptTree] The kept workspace tree could not be read:', message);
        if (live) setKept({ kind: 'unreadable', message });
      },
    );
    return (): void => { live = false; };
  }, [load, linkDown]);
  return kept;
}

/** The device's own: through the local-record seam, loaded on first use (with the lock's shape) so the shell stays light. */
export const loadKeptTree: LoadKeptTree = async (): Promise<CachedWorkspaceTree | null | 'locked'> => {
  const me: TabIdentity = await readTabIdentity();
  if (me.cid === undefined) return null;
  const [seam, { isRecordLocked }] = await Promise.all([import('@/lib/document-replica-cache'), import('@/lib/at-rest/at-rest-shape')]);
  try {
    return await seam.loadWorkspaceTree(me.cid);
  } catch (error: unknown) {
    if (isRecordLocked(error)) return 'locked';
    throw error;
  }
};

/** Keeps a node list the server sent, as of `now`; the rule for what is kept is treeToKeep's. */
export type SaveKeptTree = (nodes: Readonly<Record<string, DomainNode>>, now: number) => Promise<void>;

/**
 * Keeps each node list the server sends for this account, once it has arrived (never the list
 * of a page still loading). A failed write is reported, never thrown into the page.
 */
export function useKeepWorkspaceTree(save: SaveKeptTree, nodes: Readonly<Record<string, DomainNode>>, loading: boolean): void {
  useEffect((): void => {
    if (loading) return;
    save(nodes, Date.now()).catch((error: unknown): void => console.warn('[useKeepWorkspaceTree] Keeping the workspace tree on this device failed:', error));
  }, [save, nodes, loading]);
}

/** Loaded on first use, with the rule, so the landing shell carries neither. */
export const saveKeptTree: SaveKeptTree = async (nodes: Readonly<Record<string, DomainNode>>, now: number): Promise<void> => {
  const [{ treeToKeep }, { saveWorkspaceTree }] = await Promise.all([import('@/lib/offline-tree'), import('@/lib/document-replica-cache')]);
  const tree: CachedWorkspaceTree | null = treeToKeep(nodes, now);
  if (tree === null) return;
  const me: TabIdentity = await readTabIdentity();
  // A server's node list with no account on the tab to keep it under is not a state this page reaches quietly.
  if (me.cid === undefined) throw new Error('a node list arrived with no account signed in on this tab');
  await saveWorkspaceTree(me.cid, tree);
};
