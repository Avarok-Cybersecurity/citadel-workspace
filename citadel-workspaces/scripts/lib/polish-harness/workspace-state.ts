import type { DomainNode, DomainPermissions } from 'citadel-workspace-client-ts';
import type { WorkspaceState } from '@/contexts/WorkspaceContext';
import { EMPTY_DOCUMENT_HASH } from '@/lib/mdx-integrity';

/**
 * A whole WorkspaceState for a scenario: the context's state before anything has loaded, with the
 * scenario's own fields over it. A scenario that handed the provider only the fields it read left the
 * rest undefined, which the typecheck could not see in .jsx and a component reading them would crash on.
 */
export function workspaceState(fields: Partial<WorkspaceState>): WorkspaceState {
  return {
    members: {}, nodes: {}, nodesUnavailable: false, membershipRefused: false, treeSchema: null,
    loading: { workspace: false, members: false, nodes: false }, messages: { byPeer: {} }, typing: { peerIds: [], lastUpdated: 0 },
    ...fields,
  };
}

/**
 * Least privilege for a scenario's nodes: no pane these feed reads it. Typed whole, so a permission
 * added to the protocol fails the harness typecheck here instead of arriving undefined.
 */
const NO_PERMISSIONS: DomainPermissions = {
  view_content: false, view_members: false, read_messages: false, download_files: false,
  edit_content: false, edit_mdx: false, send_messages: false, upload_files: false,
  create_node: false, delete_node: false, update_node: false, add_node: false,
  edit_node_config: false, update_node_settings: false, manage_node_members: false,
  create_workspace: false, update_workspace: false, delete_workspace: false, edit_workspace_config: false,
  add_users: false, remove_users: false, ban_user: false, manage_domains: false,
  configure_system: false, edit_tree_structure: false, manage_node_types: false, themes: false,
};

/**
 * A tree node with the fields a scenario names and the rest empty: the root is the workspace, any
 * other node a child space. Nothing a scenario does not name is read by the panes these feed.
 */
export function domainNode(fields: Pick<DomainNode, 'id' | 'name' | 'parent_id' | 'children' | 'metadata'>): DomainNode {
  return {
    entity_type: fields.parent_id === null ? 'Workspace' : { Child: 'Space' }, depth: 0, description: '', owner_id: '', members: [],
    mdx_content: '', mdx_content_hash: EMPTY_DOCUMENT_HASH, rules: null, chat_enabled: false, chat_channel_id: null,
    default_permissions: NO_PERMISSIONS, allowed_child_types: [], is_default: false, created_at: 0n, updated_at: 0n,
    ...fields,
  };
}
