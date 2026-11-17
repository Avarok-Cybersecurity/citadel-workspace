import { useEffect } from 'react';
import { workspaceEvents, type ConnectionInfo } from '@/lib/workspace-events';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import type { DomainNode, TreeNode, TreeSchema } from '@/components/layout/sidebar/TreeNodesSection';
import type { WorkspaceEventState } from '../WorkspaceEventHandler';
import { runAsyncSetup, upsertNode, removeNode, nodesFromList } from './event-setup-utils';
import { setTreeSchema } from '@/lib/entity-type-registry';
import { armLoadingDeadline, cancelLoadingDeadline } from '@/lib/loading-flag-timeout';

interface UseNodeEventSetupProps {
  setState: React.Dispatch<React.SetStateAction<WorkspaceEventState>>;
}

/** Flatten a TreeNode into a flat array of DomainNodes. */
function flattenTree(treeNode: TreeNode): DomainNode[] {
  const result: DomainNode[] = [treeNode.node];
  for (const child of treeNode.children) {
    result.push(...flattenTree(child));
  }
  return result;
}

export function useNodeEventSetup({ setState }: UseNodeEventSetupProps): void {
  useEffect(() => {
    // onNodeEvent returns its unsubscribe synchronously; the setup that calls it
    // is async, so an unmount can beat the subscription. `cancelled` tears down
    // whatever arrives after that. See useMemberEventSetup for the same shape.
    const unsubscribes: Array<() => void> = [];
    let cancelled: boolean = false;
    const keep = (unsubscribe: () => void): void => {
      if (cancelled) unsubscribe();
      else unsubscribes.push(unsubscribe);
    };

    const setupNodeListeners = async (): Promise<void> => {
      // Loading state
      keep(workspaceEvents.onNodeEvent('nodes:loading', (_connectionInfo: ConnectionInfo) => {
        setState(prev => ({
          ...prev,
          loading: { ...prev.loading, nodes: true },
        }));
        // listNodes resolves when the request is SENT. If the response never
        // arrives the flag would stay raised and the tree would spin forever.
        // Lowering it is right; falling back to the EMPTY state is not, because
        // "we never heard back" is not "you have nothing".
        armLoadingDeadline('nodes', () =>
          setState(prev => ({
            ...prev,
            loading: { ...prev.loading, nodes: false },
            nodesUnavailable: true,
          }))
        );
      }));

      // Multiple nodes loaded
      keep(workspaceEvents.onNodeEvent('nodes:loaded', (payload: { nodes: DomainNode[]; connection: ConnectionInfo }) => {
        cancelLoadingDeadline('nodes');
        setState(prev => {
          const updatedNodes: { [x: string]: DomainNode; } = nodesFromList(payload.nodes);

          broadcastChannelService.broadcastStateSync({
            type: 'nodes',
            data: updatedNodes,
          });

          return {
            ...prev,
            nodes: updatedNodes,
            loading: { ...prev.loading, nodes: false },
            // An answer arrived, so whatever the deadline concluded is stale.
            nodesUnavailable: false,
          };
        });
      }));

      // Single node loaded (create/get/update)
      keep(workspaceEvents.onNodeEvent('node:loaded', (payload: { node: DomainNode; connection: ConnectionInfo }) => {
        // Through the helper rather than inline. `upsertNode` and `removeNode`
        // existed in event-setup-utils with no callers, while this file spelled
        // both bodies out again -- so the shared helpers and the code that
        // actually runs were separate implementations of the same rule, and a
        // fix to either would have reached one of them.
        upsertNode(setState, payload.node);
      }));

      // Node deleted (with cascaded children)
      keep(workspaceEvents.onNodeEvent('node:deleted', (payload: { nodeId: string; childrenDeleted: string[]; connection: ConnectionInfo }) => {
        removeNode(setState, payload.nodeId, payload.childrenDeleted);
      }));

      // Someone ELSE saved this node's content. The server broadcasts to every
      // member except the editor, so without this the rest of the workspace kept
      // rendering the copy they loaded — a document could be edited and nobody
      // watching it would see the change until they navigated away and back.
      keep(workspaceEvents.onNodeEvent('node:content-updated', (payload: { nodeId: string; mdxContent: string; mdxContentHash?: string; updatedBy: string; timestamp: number; connection: ConnectionInfo }) => {
        setState(prev => {
          const node: DomainNode = prev.nodes[payload.nodeId];
          // Not a node this client knows about; nothing to refresh.
          if (!node) return prev;
          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              // The hash travels WITH the content. Merging new content over
              // the cached node while keeping its old hash made the integrity
              // check refuse a document that had merely been edited by a
              // colleague — and go on refusing until the reader navigated away
              // and back. The verifier and this broadcast were built two rounds
              // apart, and ordinary collaborative editing was the trigger.
              [payload.nodeId]: {
                ...node,
                mdx_content: payload.mdxContent,
                mdx_content_hash: payload.mdxContentHash ?? null,
              },
            },
          };
        });
      }));

      // Node moved (reparented)
      keep(workspaceEvents.onNodeEvent('node:moved', (payload: { nodeId: string; oldParentId: string | null; newParentId: string | null; connection: ConnectionInfo }) => {
        setState(prev => {
          const node: DomainNode = prev.nodes[payload.nodeId];
          if (!node) return prev;
          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [payload.nodeId]: { ...node, parent_id: payload.newParentId },
            },
          };
        });
      }));

      // Full tree structure loaded — flatten into the nodes map
      keep(workspaceEvents.onNodeEvent('tree:structure:loaded', (payload: { root: TreeNode; connection: ConnectionInfo }) => {
        const flatNodes: DomainNode[] = flattenTree(payload.root);
        setState(prev => {
          const updatedNodes: Record<string, DomainNode> = {};
          for (const node of flatNodes) {
            updatedNodes[node.id] = node;
          }
          return {
            ...prev,
            nodes: updatedNodes,
            loading: { ...prev.loading, nodes: false },
          };
        });
      }));

      // Tree schema loaded — feed to entity-type-registry (SSOT) and state
      keep(workspaceEvents.onNodeEvent('tree:schema:loaded', (payload: { schema: TreeSchema; connection: ConnectionInfo }) => {
        setTreeSchema(payload.schema);
        setState(prev => ({
          ...prev,
          treeSchema: payload.schema,
        }));
      }));
    };

    runAsyncSetup(setupNodeListeners);

    return (): void => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes.length = 0;
    };
  }, [setState]);
}
