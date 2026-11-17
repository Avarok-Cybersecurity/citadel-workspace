import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { rosterDisplayName, selfDisplayName } from '@/lib/roster-display-name';
import { useLocation } from 'react-router-dom';
import { BaseOffice } from '../office/BaseOffice';
import { P2PChat } from '../p2p/P2PChat';
import { getDefaultNodeContent, getDefaultChildNodeContent, getWorkspaceHomeContent } from '@/lib/default-mdx-content';
import { topLevelTrees } from '@/components/layout/sidebar/tree-node-utils';
import type { TreeNode } from '@/components/layout/sidebar/tree-node-types';
import { NodeNotFound } from './NodeNotFound';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { isVariant } from 'citadel-workspace-client-ts';
import { connectionManager } from '@/lib/connection';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { selfCid, type TabIdentity } from '@/lib/tab-identity';
import { tryParseCid } from '@/lib/utils/cid-utils';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { nodeInView } from '@/lib/workspace-navigation';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { useP2PChannelParam } from './use-p2p-channel-param';
import { nodeAppState, type NodeAppState } from '@/lib/citadel-apps/node-app-metadata';
import { DocumentView } from '../documents/DocumentView';
import { OfflineKeptNode } from './OfflineKeptNode';
import { reconnectingTo } from '@/lib/reconnect/server-reconnect';
import { loadKeptTree, useKeptTree, type KeptTree } from '@/hooks/use-kept-tree';
import { shownNode, type ShownNode } from '@/lib/offline-tree';

interface WorkspaceViewProps {
  nodeId?: string | null;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({ nodeId: nodeParam }) => {
  const { state } = useWorkspace();
  // The root's sentinel id is the home, not a missing page; see nodeInView.
  const nodeId: string | null = nodeInView(nodeParam, state.nodes);
  const location: ReturnType<typeof useLocation> = useLocation();
  const me: TabIdentity | null = useTabIdentity();
  // The kept tree, only while the agent says the server link is down; a live node always wins.
  const linkDown: boolean = useSyncExternalStore(reconnectingTo.subscribe, reconnectingTo.get) !== null;
  const kept: KeptTree = useKeptTree(loadKeptTree, linkDown);
  const shown: ShownNode = nodeId ? shownNode(nodeId, state.nodes, linkDown, kept.kind === 'kept' ? kept.tree : null) : { kind: 'none' };

  // Parse query parameters for P2P chat
  const params: URLSearchParams = new URLSearchParams(location.search);
  const showP2P: boolean = params.get('showP2P') === 'true';
  const peerName: string | null = params.get('p2pUser');
  const peerCid: string | null = useP2PChannelParam(params.get('channel'), peerName);

  // Get entity data from unified node hierarchy
  const node: DomainNode | null = nodeId ? state.nodes[nodeId] : null;

  // Determine whether this node has children (e.g., Office) or is a leaf (e.g., Room)
  const isLeafNode: boolean | null = node && isVariant(node.entity_type as Record<string, unknown>, 'Child')
    && (!node.allowed_child_types || node.allowed_child_types.length === 0);

  // useCallback, not a bare arrow. A new identity every render put this in
  // BaseOffice's content effect dependencies and re-ran it on every unrelated
  // store change — which overwrote the editor buffer.
  const workspaceName: string = state.workspace?.name || 'Your workspace';
  // A string, so an unrelated store change that rebuilds `nodes` leaves the callback below alone.
  const homeContent: string = useMemo((): string => getWorkspaceHomeContent(
    workspaceName, state.workspace?.description ?? '', topLevelSpaces(state.nodes),
  ), [workspaceName, state.workspace?.description, state.nodes]);
  const getInitialContent: () => string = useCallback((): string => {
    if (node && isLeafNode) {
      return getDefaultChildNodeContent(node.name, node.description);
    }
    if (node) {
      return getDefaultNodeContent(node.name);
    }
    return homeContent;
  }, [node, isLeafNode, homeContent]);

  // Determine entity details
  const entityTitle: string = node?.name || workspaceName;

  // When P2P chat is active, show the chat view
  if (showP2P && peerCid) {
    // The tab's identity first, the connection's second: see selfCid.
    const connectionInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
    const rawCid: bigint | undefined = selfCid(me, connectionInfo);
    const currentUserCid: string | undefined = rawCid !== undefined ? String(rawCid) : undefined;
    const currentUserName: string = selfDisplayName(state.members, {
      username: me?.username, fullName: me?.fullName,
    }) || 'You';

    // Both `BigInt(...)` calls below are funnelled through
    // `tryParseCid` so the parsing contract (and its boundary cases:
    // empty string, malformed input, fractional / scientific
    // notation) is exercised by `cid-utils.test.ts#tryParseCid`
    // rather than baked into this render path. peerCid coming from
    // `params.get('channel')` is the historical crash surface;
    // currentUserCid is defensive against corrupted IndexedDB state.
    const parsedPeerCid: bigint | undefined = tryParseCid(peerCid);
    if (parsedPeerCid === undefined) {
      // Invalid CID in URL — fall through to normal workspace view
      return (
        <BaseOffice
          title={entityTitle}
          getInitialContent={getInitialContent}
          nodeId={nodeId || undefined}
        />
      );
    }
    const parsedCurrentUserCid: bigint | undefined = tryParseCid(currentUserCid);

    return (
      <div className="h-full bg-background">
        {/* Keyed by peer — see the note in pages/Messages.tsx. */}
        <P2PChat
          key={parsedPeerCid.toString()}
          peerCid={parsedPeerCid}
          peerName={rosterDisplayName(state.members, peerName ?? undefined) ?? (peerName || undefined)}
          peerUsername={peerName ?? undefined}
          currentUserCid={parsedCurrentUserCid}
          currentUserName={currentUserName}
        />
      </div>
    );
  }

  // A URL naming a node we do not have is not the same as no URL at all. Both
  // used to fall through to `getDefaultMDXShowcase()` and render the editor
  // demo as though it were the document -- see NodeNotFound.
  //
  // Gated on the nodes having loaded: during the initial fetch `state.nodes` is
  // empty for every id, and announcing "no longer here" about a page that is
  // simply still arriving would be its own lie.
  if (shown.kind === 'kept') return <OfflineKeptNode key={shown.node.id} node={shown.node} savedAt={shown.savedAt} />;
  if (nodeId && !node && !state.loading.nodes) {
    return <NodeNotFound nodeId={nodeId} />;
  }

  // A document node opens in its app, not as a page; see lib/citadel-apps.
  const app: NodeAppState = node ? nodeAppState(node.metadata) : { kind: 'none' };
  if (node && app.kind !== 'none') return <DocumentView key={node.id} node={node} app={app} />;

  // Otherwise show the normal workspace content
  return (
    <BaseOffice
      // Keyed: without it React reuses the instance across nodes, so `isEditing`
      // stayed true while the buffer was swapped to the other node's body.
      key={nodeId ?? WORKSPACE_ROOT_ID}
      title={entityTitle}
      getInitialContent={getInitialContent}
      nodeId={nodeId || undefined}
    />
  );
};

/** The spaces directly under the workspace, by the sidebar's own rule. */
function topLevelSpaces(nodes: Record<string, DomainNode>): DomainNode[] {
  return topLevelTrees(Object.values(nodes)).map((tree: TreeNode): DomainNode => tree.node);
}
