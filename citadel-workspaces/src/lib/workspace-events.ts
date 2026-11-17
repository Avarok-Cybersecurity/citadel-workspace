// Workspace events for WebSocket integration
import { User } from '../types/workspace-entities';
import { notifyEach } from '@/lib/notify-listeners';
import type { WorkspaceMetadataTS } from '../types/workspace-protocol';
import type { DomainNode, TreeNode, TreeSchema } from '@/components/layout/sidebar/TreeNodesSection';
import { eventEmitter } from './event-emitter';

// Type for unlisten function
export type UnlistenFn = () => void;

// Connection information coming from the backend
export interface ConnectionInfo {
  cid: bigint;
  peer_cid?: bigint;
  request_id: string;
}

// Event payload types for different events
export interface WorkspacePayload {
  workspace: {
    id: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };
  connection: ConnectionInfo;
}

export interface MemberPayload {
  member: User;
  connection: ConnectionInfo;
}

export interface MembersPayload {
  members: User[];
  connection: ConnectionInfo;
  /**
   * Which domain this list is for, when the server said. Undefined against a
   * server that predates the field -- a subscriber that cannot tell should keep
   * its old behaviour rather than discard the list.
   */
  domainId?: string;
  /**
   * Member id -> the level above that gives them access to `domainId`. Empty
   * when everyone is listed on the domain itself, and against a server that
   * predates the field, which lists direct members only.
   */
  inheritedFrom: Readonly<Record<string, string>>;
  /**
   * Listed members a live booking link names as guests. The server sends them only to callers
   * who can manage roles; empty for everyone else, and from a server that predates the field.
   */
  guests: readonly string[];
}

export interface WorkspacesPayload {
  workspaces: WorkspaceMetadataTS[];
  connection: ConnectionInfo;
}

export interface ErrorPayload {
  message: string;
  connection: ConnectionInfo;
}

export interface MessagePayload {
  peerCid?: bigint;
  contentLength: number;
  contents?: string;
  connection: ConnectionInfo;
}

// Typing indicator payload
export interface TypingPayload {
  peerCid: bigint;
  connection: ConnectionInfo;
}

// Protocol warning payload for unexpected request types
export interface ProtocolWarningPayload {
  message: string;
  requestType: string;
  connection: ConnectionInfo;
}

// Event map: maps each event string to its payload type
export interface WorkspaceEventMap {
  // Workspace events
  'workspace:loading': ConnectionInfo;
  'workspace:loaded': WorkspacePayload;
  'workspace:created': WorkspacePayload;
  'workspace:not-initialized': ConnectionInfo;
  'workspaces:listed': WorkspacesPayload;
  // Member events
  'member:adding': { user_id: string; domain_id?: string; connection: ConnectionInfo };
  'member:added': { member: User; connection: ConnectionInfo };
  'member:loading': { user_id: string; connection: ConnectionInfo };
  'member:updating_role': { user_id: string; connection: ConnectionInfo };
  'member:updating_permissions': { userId: string; domainId: string; connection: ConnectionInfo };
  'member:removing': { userId: string; domainId?: string; connection: ConnectionInfo };
  'member:removed': { userId: string; connection: ConnectionInfo };
  'member:loaded': MemberPayload;
  'members:loading': { domainId?: string; connection: ConnectionInfo };
  'members:loaded': MembersPayload;
  /** An admin has hidden `domainId`'s roster from this user: not an empty list. */
  'members:hidden': { domainId: string; connection: ConnectionInfo };
  'members:reload': ConnectionInfo;
  'member:role-updated': { userId: string; role: string; roleId: string | null; connection: ConnectionInfo };
  'user:permissions:loaded': { userId: string; role: string; roleId: string | null; permissions: unknown[]; domainId: string; connection: ConnectionInfo };
  // Message events
  'message:received': MessagePayload;
  'typing:started': TypingPayload;
  'typing:stopped': TypingPayload;
  // Node events (generic hierarchy)
  'node:loaded': { node: DomainNode; connection: ConnectionInfo };
  'node:deleted': { nodeId: string; childrenDeleted: string[]; connection: ConnectionInfo };
  'node:moved': { nodeId: string; oldParentId: string | null; newParentId: string | null; connection: ConnectionInfo };
  'node:content-updated': {
    nodeId: string;
    mdxContent: string;
    /**
     * The new content's hash, so a watcher verifies what it just received.
     *
     * Absent when the server predates the field, which reads as "unhashed"
     * rather than "mismatch" — refusing content because the server is older
     * would be the same defect the hash exists to prevent.
     */
    mdxContentHash?: string;
    updatedBy: string;
    timestamp: number;
    connection: ConnectionInfo;
  };
  'nodes:loading': ConnectionInfo;
  'nodes:loaded': { nodes: DomainNode[]; connection: ConnectionInfo };
  'tree:structure:loaded': { root: TreeNode; connection: ConnectionInfo };
  'tree:schema:loaded': { schema: TreeSchema; connection: ConnectionInfo };
  'node:types:loaded': { nodeTypes: unknown[]; connection: ConnectionInfo };
  // Operation events
  'operation:success': ConnectionInfo;
  'operation:error': ErrorPayload;
  'operation:deleted': ConnectionInfo;
  // Protocol events
  'protocol:warning': ProtocolWarningPayload;
}

// Define all event types
export type WorkspaceEventType = keyof WorkspaceEventMap;

// Subset types for each method category
type WorkspaceEventKeys = 'workspace:loading' | 'workspace:loaded' | 'workspace:created' | 'workspace:not-initialized' | 'workspaces:listed' | 'members:reload';
type NodeEventKeys = 'node:loaded' | 'node:deleted' | 'node:moved' | 'node:content-updated' | 'nodes:loading' | 'nodes:loaded' | 'tree:structure:loaded' | 'tree:schema:loaded' | 'node:types:loaded';
type MemberEventKeys = 'member:adding' | 'member:added' | 'member:loading' | 'member:updating_role' | 'member:updating_permissions' | 'member:removing' | 'member:removed' | 'member:loaded' | 'members:loading' | 'members:loaded' | 'members:hidden' | 'members:reload' | 'member:role-updated' | 'user:permissions:loaded';
type MessageEventKeys = 'message:received' | 'typing:started' | 'typing:stopped';
type OperationEventKeys = 'operation:success' | 'operation:error' | 'operation:deleted';
type ProtocolEventKeys = 'protocol:warning';

/**
 * Helper class to manage workspace event listeners
 */
export class WorkspaceEvents {
  private listeners: Map<string, UnlistenFn[]> = new Map();

  // Single internal cast to bridge the type-safe public API to the untyped eventEmitter.on()
  private registerListener<K extends WorkspaceEventType>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    const unlistenFn: () => void = eventEmitter.on(event, callback as (payload: unknown) => void);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(unlistenFn);
    return () => {
      unlistenFn();
      const listeners: UnlistenFn[] = this.listeners.get(event) || [];
      const index: number = listeners.indexOf(unlistenFn);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  // Workspace events
  public onWorkspaceEvent<K extends WorkspaceEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  // Node events (generic hierarchy)
  public onNodeEvent<K extends NodeEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  // Member events
  public onMemberEvent<K extends MemberEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  // Message events
  public onMessageEvent<K extends MessageEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  // Operation events
  public onOperationEvent<K extends OperationEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  // Protocol events
  public onProtocolEvent<K extends ProtocolEventKeys>(event: K, callback: (payload: WorkspaceEventMap[K]) => void): () => void {
    return this.registerListener(event, callback);
  }

  /**
   * How many listeners this facade currently holds for `event`.
   *
   * Exists so a leaked subscription is observable in a test. A discarded
   * unsubscribe has no runtime symptom — setState on an unmounted component is a
   * no-op — so without a count there is nothing to assert on.
   */
  public listenerCount(event: WorkspaceEventType): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * Clean up all event listeners
   */
  public cleanupAllListeners(): void {
    for (const [, listeners] of this.listeners.entries()) {
      notifyEach(listeners, 'workspace-events cleanup');
    }
    this.listeners.clear();
  }
}

// Export a singleton instance
export const workspaceEvents: WorkspaceEvents = new WorkspaceEvents();
