/**
 * Opening a node in the tree: the one way, wherever it is asked for.
 *
 * The sidebar's row select and the header's breadcrumbs both go here, so both
 * ask before discarding an unsaved document (`useGuardedNavigate`), and both
 * leave the same URL: the node, with the section (and its keys) and any chat overlay cleared,
 * built by `buildWorkspacePath`. A second copy of this is how one of them would
 * come to keep a stale `showP2P` and open the chat over the node you asked for.
 */
import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { buildWorkspacePath, leaveSection } from '@/lib/workspace-navigation';
import { useGuardedNavigate, type GuardedNavigate } from './use-guarded-navigate';

/** The URL that opens `nodeId`, from the current search. */
export function selectNodePath(search: string, nodeId: string): string {
  const params: URLSearchParams = new URLSearchParams(search);
  params.set('nodeId', nodeId);
  // The section and its own keys (the file manager's peer, path, item) go with it.
  leaveSection(params);
  // A chat overlay belongs to the node it was opened on.
  params.delete('showP2P');
  params.delete('channel');
  params.delete('p2pUser');
  return buildWorkspacePath(params);
}

export type SelectNode = (nodeId: string) => Promise<void>;

export function useSelectNode(): SelectNode {
  const { search }: ReturnType<typeof useLocation> = useLocation();
  const navigate: GuardedNavigate = useGuardedNavigate();
  return useCallback((nodeId: string): Promise<void> => navigate(selectNodePath(search, nodeId)), [search, navigate]);
}
