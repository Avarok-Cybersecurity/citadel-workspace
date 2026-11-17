/**
 * Tree hierarchy types for the workspace domain node system.
 * These types mirror the definitions in citadel-workspace-client-ts/src/types/workspace-types.ts.
 * Once the client package is rebuilt with tree types, these can be imported directly.
 */

/**
 * Entity type for nodes in the workspace hierarchy tree.
 * Workspace is special (root only), all other nodes are Child types.
 */
export type NodeEntityType = "Workspace" | { Child: string };

/**
 * Default permissions for a domain
 */
export interface DomainPermissions {
  view_content: boolean;
  /** On a node: "Members can see each other". False hides its roster, and every roster below it, from non-admins. */
  view_members: boolean;
  read_messages: boolean;
  download_files: boolean;
  edit_content: boolean;
  edit_mdx: boolean;
  send_messages: boolean;
  upload_files: boolean;
  create_node: boolean;
  delete_node: boolean;
  update_node: boolean;
  add_node: boolean;
  edit_node_config: boolean;
  update_node_settings: boolean;
  manage_node_members: boolean;
  create_workspace: boolean;
  update_workspace: boolean;
  delete_workspace: boolean;
  edit_workspace_config: boolean;
  add_users: boolean;
  remove_users: boolean;
  ban_user: boolean;
  manage_domains: boolean;
  configure_system: boolean;
  edit_tree_structure: boolean;
  manage_node_types: boolean;
  /** Edit the workspace theme shown to every member. */
  themes: boolean;
}

/**
 * A unified node in the workspace hierarchy tree.
 * Replaces the separate Workspace/Office/Room structs with a single generalized type.
 */
export interface DomainNode {
  id: string;
  parent_id: string | null;
  entity_type: NodeEntityType;
  depth: number;
  name: string;
  description: string;
  owner_id: string;
  members: string[];
  children: string[];
  mdx_content: string;
  /**
   * SHA-256 of `mdx_content`, hex, computed by the server on write. Verified
   * before the document is executed — see lib/mdx-integrity.ts. Null for
   * documents stored before the field existed.
   */
  mdx_content_hash: string | null;
  rules: string | null;
  chat_enabled: boolean;
  chat_channel_id: string | null;
  default_permissions: DomainPermissions;
  metadata: number[];
  allowed_child_types: string[] | null;
  is_default: boolean;
  created_at: bigint;
  updated_at: bigint;
}

/**
 * Recursive tree structure for representing the full hierarchy
 */
export interface TreeNode {
  node: DomainNode;
  children: TreeNode[];
}

// TreeSchema and NestingRule types imported from canonical source (SSOT)
export type { TreeSchema, NestingRule, EntityTypeConfig } from 'citadel-workspace-client-ts';
