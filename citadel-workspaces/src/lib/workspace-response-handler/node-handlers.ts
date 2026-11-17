/**
 * Workspace Response Handler - Tree Node Handlers
 *
 * Handles Node, Nodes, TreeStructure, TreeSchema, NodeTypes,
 * NodeDeleted, and NodeMoved response variants.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { debugLog } from '@/lib/debug-config';
import { isVariant , type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from './workspace-handlers';

/**
 * Try to handle tree-node response variants.
 *
 * Returns `true` if the response was handled.
 */
export function handleNodeVariants(
  response: WorkspaceProtocolResponse,
  connectionInfo: ConnectionInfo,
): boolean {
  if (isVariant(response, 'Node')) {
    const node: Extract<WorkspaceProtocolResponse, { Node: unknown }>['Node'] = response.Node;
    debugLog('WorkspaceResponseHandler', 'Node response received', {
      id: node.id, name: node.name, entityType: node.entity_type,
    });
    eventEmitter.emit('node:loaded', { node, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'Nodes')) {
    debugLog('WorkspaceResponseHandler', 'Nodes response received', { count: response.Nodes.length });
    eventEmitter.emit('nodes:loaded', { nodes: response.Nodes, connection: connectionInfo });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'TreeStructure')) {
    debugLog('WorkspaceResponseHandler', 'TreeStructure response received');
    eventEmitter.emit('tree:structure:loaded', {
      root: response.TreeStructure.root, connection: connectionInfo,
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'TreeSchema')) {
    debugLog('WorkspaceResponseHandler', 'TreeSchema response received');
    eventEmitter.emit('tree:schema:loaded', {
      schema: response.TreeSchema, connection: connectionInfo,
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'NodeTypes')) {
    debugLog('WorkspaceResponseHandler', 'NodeTypes response received', { count: response.NodeTypes.length });
    eventEmitter.emit('node:types:loaded', {
      nodeTypes: response.NodeTypes, connection: connectionInfo,
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'NodeDeleted')) {
    const { node_id, children_deleted } = response.NodeDeleted;
    debugLog('WorkspaceResponseHandler', 'NodeDeleted response received', {
      node_id, childrenDeleted: children_deleted.length,
    });
    eventEmitter.emit('node:deleted', {
      nodeId: node_id, childrenDeleted: children_deleted, connection: connectionInfo,
    });
    // A deleted document's decrypted copy leaves this device (and its children's).
    import('@/lib/document-replica-cache').then(({ forgetDeletedNodes }) => forgetDeletedNodes([node_id, ...children_deleted])).catch((error: unknown): void => {
      debugLog('WorkspaceResponseHandler', 'Could not remove deleted documents\' local copies', error);
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  // Broadcast by the server to every OTHER member when someone saves a node's
  // content (async_process_command.rs, on UpdateNode with mdx_content). Nothing
  // in the UI handled it: the editor saw their own change, everyone else kept
  // the version they loaded until they navigated away and back. The one response
  // variant of 25 with no handler on this side.
  if (isVariant(response, 'NodeContentUpdated')) {
    const { node_id, mdx_content, mdx_content_hash, updated_by, timestamp } =
      response.NodeContentUpdated;
    debugLog('WorkspaceResponseHandler', 'NodeContentUpdated response received', {
      node_id, updated_by, length: mdx_content.length,
    });
    eventEmitter.emit('node:content-updated', {
      nodeId: node_id,
      mdxContent: mdx_content,
      mdxContentHash: mdx_content_hash ?? undefined,
      updatedBy: updated_by,
      // ts-rs declares this bigint; the wire is JSON with no reviver, so it
      // arrives as a number. Coerced rather than cast, so the value is what the
      // type says either way.
      timestamp: Number(timestamp),
      connection: connectionInfo,
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  if (isVariant(response, 'NodeMoved')) {
    const { node_id, old_parent_id, new_parent_id } = response.NodeMoved;
    debugLog('WorkspaceResponseHandler', 'NodeMoved response received', {
      node_id, old_parent_id, new_parent_id,
    });
    eventEmitter.emit('node:moved', {
      nodeId: node_id, oldParentId: old_parent_id, newParentId: new_parent_id, connection: connectionInfo,
    });
    eventEmitter.emit('workspace:raw-response', response);
    return true;
  }

  return false;
}
