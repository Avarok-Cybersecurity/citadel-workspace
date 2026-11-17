/**
 * Workspace Service - Node Operations
 *
 * Methods for generic tree node management: create, update, delete,
 * list, get tree structure, get tree schema, and server capabilities.
 */

import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { workspaceResponseHandler } from '@/lib/workspace-response-handler';
import { awaitWriteResponse } from './await-write-response';
import { aboutNode, newChildOf, nodeWithId } from './response-matchers';
import type { ProtocolSender } from './workspace-operations';

/**
 * Create a node in the workspace hierarchy.
 */
export async function createNode(
  sender: ProtocolSender,
  parentId: string | null,
  entityType: { Child: string } | 'Workspace',
  name: string,
  description: string,
  options?: { mdxContent?: string; metadata?: Uint8Array; isDefault?: boolean },
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    CreateNode: {
      parent_id: parentId,
      entity_type: entityType,
      name,
      description,
      mdx_content: options?.mdxContent,
      metadata: options?.metadata ? Array.from(options.metadata) : undefined,
      is_default: options?.isDefault,
    },
  };
  // Resolves when the SERVER has accepted it, not when the frame leaves.
  // A refusal arrives as a response, which cannot reject a send-only promise —
  // so this used to report success for writes the server was about to refuse.
  // The matcher is not optional now that the server broadcasts `Node` to every
  // other member: without it, any other member's tree write resolves this one.
  return awaitWriteResponse(
    'CreateNode',
    () => sender.sendProtocolRequest(requestPart),
    newChildOf(parentId, name),
  );
}

/**
 * Update an existing node.
 */
export async function updateNode(
  sender: ProtocolSender,
  nodeId: string,
  updates: {
    name?: string;
    description?: string;
    mdxContent?: string;
    rules?: string;
    chatEnabled?: boolean;
    isDefault?: boolean;
  },
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    UpdateNode: {
      node_id: nodeId,
      name: updates.name,
      description: updates.description,
      mdx_content: updates.mdxContent,
      rules: updates.rules,
      chat_enabled: updates.chatEnabled,
      is_default: updates.isDefault,
    },
  };
  // Resolves when the SERVER has accepted it, not when the frame leaves.
  // A refusal arrives as a response, which cannot reject a send-only promise —
  // so this used to report success for writes the server was about to refuse.
  return awaitWriteResponse(
    'UpdateNode',
    () => sender.sendProtocolRequest(requestPart),
    nodeWithId(nodeId),
  );
}

/**
 * Switch "Members can see each other" on a node. Admin only; the server refuses
 * anyone else. Resolves on the server's `Node` answer for this node.
 */
export async function setMembersVisible(sender: ProtocolSender, nodeId: string, visible: boolean): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = { SetMembersVisible: { node_id: nodeId, visible } };
  return awaitWriteResponse('SetMembersVisible', () => sender.sendProtocolRequest(requestPart), nodeWithId(nodeId));
}

/**
 * Delete a node and optionally cascade-delete its children.
 */
export async function deleteNode(
  sender: ProtocolSender,
  nodeId: string,
  cascade: boolean = true
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    DeleteNode: { node_id: nodeId, cascade },
  };
  // Resolves when the SERVER has accepted it, not when the frame leaves.
  // A refusal arrives as a response, which cannot reject a send-only promise —
  // so this used to report success for writes the server was about to refuse.
  return awaitWriteResponse(
    'DeleteNode',
    () => sender.sendProtocolRequest(requestPart),
    aboutNode(nodeId),
  );
}

/**
 * List nodes, optionally filtered by parent or entity types.
 */
export async function listNodes(
  sender: ProtocolSender,
  parentId?: string | null,
  entityTypes?: Array<{ Child: string } | 'Workspace'>,
): Promise<void> {
  // `state.loading.nodes` had no writer at all, so it was permanently false and
  // TreeNodesSection's guard — `if (!isLoading && !treeData)` — fired on every
  // workspace open, telling the user "Your workspace is empty. Click the + button
  // to create your first space." while the tree was still in flight. The
  // "Loading..." arm inside that branch is unreachable by construction, which is
  // why it read as correct.
  workspaceResponseHandler.emitLoadingEvent('nodes:loading');
  const requestPart: WorkspaceProtocolRequestTS = {
    ListNodes: {
      parent_id: parentId,
      entity_types: entityTypes,
    },
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Get the full tree structure starting from a root node.
 */
export async function getTreeStructure(
  sender: ProtocolSender,
  rootId?: string,
  maxDepth?: number
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    GetTreeStructure: {
      root_id: rootId ?? null,
      max_depth: maxDepth,
    },
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Get the current tree schema (nesting rules).
 */
export async function getTreeSchema(sender: ProtocolSender): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    GetTreeSchema: null,
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Get server file transfer and storage capabilities
 */
export async function getServerCapabilities(sender: ProtocolSender): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    GetServerCapabilities: null
  };
  return sender.sendProtocolRequest(requestPart);
}

/**
 * Move a node to a different parent.
 *
 * `MoveNode` has been fully plumbed on both sides for a long time: typed in the
 * protocol, permission-gated in the kernel, broadcast to other members,
 * gate-mapped in `SUCCESS_RESPONSES`, and handled by the client's node event
 * setup. It had no client method and no UI, so reorganising a workspace was
 * simply impossible — a whole capability built from both ends and never joined
 * in the middle.
 *
 * `null` moves the node to the workspace root.
 */
export async function moveNode(
  sender: ProtocolSender,
  nodeId: string,
  newParentId: string | null,
): Promise<void> {
  const requestPart: WorkspaceProtocolRequestTS = {
    MoveNode: {
      node_id: nodeId,
      new_parent_id: newParentId,
    },
  };
  return awaitWriteResponse(
    'MoveNode',
    () => sender.sendProtocolRequest(requestPart),
    aboutNode(nodeId),
  );
}
