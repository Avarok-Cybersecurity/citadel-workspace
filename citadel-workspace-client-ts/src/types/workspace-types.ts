// Manually exported types from citadel-workspace-types
// TODO: Replace with auto-generated types from ts-rs

export interface User {
  id: string;
  name: string;
  role: UserRole;
  permissions: Record<string, Permission[]>;
  metadata: Record<string, MetadataValue>;
}

export type UserRole = 
  | "Admin"
  | "Owner"
  | "Member"
  | "Guest"
  | "Banned"
  | { Custom: [string, number] };

export type Permission =
  | "All"
  | "CreateNode"
  | "DeleteNode"
  | "UpdateNode"
  | "CreateWorkspace"
  | "UpdateWorkspace"
  | "DeleteWorkspace"
  | "EditContent"
  | "AddUsers"
  | "RemoveUsers"
  | "EditMdx"
  | "EditNodeConfig"
  | "AddNode"
  | "UpdateNodeSettings"
  | "ViewContent"
  | "ManageNodeMembers"
  | "SendMessages"
  | "ReadMessages"
  | "UploadFiles"
  | "DownloadFiles"
  | "ManageDomains"
  | "ConfigureSystem"
  | "EditWorkspaceConfig"
  | "BanUser"
  | "EditTreeStructure"
  | "ManageNodeTypes";

export interface MetadataField {
  key: string;
  value: MetadataValue;
}

export type MetadataValue =
  | { type: "String"; content: string }
  | { type: "Number"; content: number }
  | { type: "Boolean"; content: boolean }
  | { type: "Array"; content: MetadataValue[] }
  | { type: "Object"; content: Record<string, MetadataValue> }
  | { type: "Null"; content: null };

export interface Workspace {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  members: string[];
  offices: string[];
  metadata: number[];
  password_protected: boolean;
}

export interface WorkspaceMetadata {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_default: boolean;
  member_count: number;
}

export type Domain =
  | { Workspace: string };

// =============================================================================
// GENERALIZED TREE HIERARCHY TYPES
// =============================================================================

/**
 * Entity type for nodes in the workspace hierarchy tree.
 * Workspace is special (root only), all other nodes are Child types.
 */
export type NodeEntityType = "Workspace" | { Child: string };

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

/**
 * Rule defining what child types are allowed under a parent type
 */
export interface NestingRule {
  parent_type: string;
  allowed_child_types: string[];
}

/**
 * Display configuration for an entity type (icon, labels, placeholders).
 * Sent as part of TreeSchema so the frontend can derive all display metadata
 * from a single source of truth.
 */
export interface EntityTypeConfig {
  type_name: string;
  icon: string;
  label: string;
  plural_label: string;
  name_placeholder: string;
  description_placeholder: string;
}

/**
 * Schema defining the structure rules for a workspace tree
 */
export interface TreeSchema {
  id: string;
  name: string;
  rules: NestingRule[];
  max_depth: number | null;
  entity_type_configs: EntityTypeConfig[];
}

/**
 * Custom node type definition for user-created types
 */
export interface CustomNodeType {
  name: string;
  display_name: string;
  icon: string | null;
  allowed_parents: string[];
}

/**
 * Default permissions for a domain
 */
export interface DomainPermissions {
  view_content: boolean;
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
}

export type WorkspaceProtocolPayload =
  | { Request: WorkspaceProtocolRequest }
  | { Response: WorkspaceProtocolResponse };

export type WorkspaceProtocolRequest =
  | { CreateWorkspace: { name: string; description: string; workspace_master_password: string; metadata?: number[] } }
  | { GetWorkspace: { workspace_id?: string | null } }
  | "ListWorkspaces"
  | { UpdateWorkspace: { workspace_id?: string | null; name?: string; description?: string; workspace_master_password: string; metadata?: number[] } }
  | { DeleteWorkspace: { workspace_id?: string | null; workspace_master_password: string } }
  | { AddMember: { user_id: string; domain_id?: string; role: UserRole; metadata?: number[] } }
  | { GetMember: { user_id: string } }
  | { UpdateMemberRole: { user_id: string; role: UserRole; metadata?: number[] } }
  | { UpdateMemberPermissions: { user_id: string; domain_id: string; permissions: Permission[]; operation: UpdateOperation } }
  | { RemoveMember: { user_id: string; domain_id?: string } }
  | { ListMembers: { domain_id?: string } }
  | { Message: { contents: number[] } }
  // Tree node operations
  | { CreateNode: { parent_id: string | null; entity_type: NodeEntityType; name: string; description: string } }
  | { GetNode: { node_id: string } }
  | { UpdateNode: { node_id: string; name?: string; description?: string; mdx_content?: string; rules?: string; chat_enabled?: boolean } }
  | { DeleteNode: { node_id: string; cascade: boolean } }
  | { MoveNode: { node_id: string; new_parent_id: string | null } }
  | { ListNodes: { parent_id?: string; depth?: number; entity_types?: NodeEntityType[] } }
  | { GetTreeStructure: { root_id?: string; max_depth?: number } }
  | "GetTreeSchema"
  | { UpdateTreeSchema: { schema: TreeSchema } }
  | { CreateNodeType: { name: string; display_name: string; icon?: string; allowed_parents: string[] } }
  | "ListNodeTypes";

export type WorkspaceProtocolResponse =
  | { Workspace: Workspace }
  | { Workspaces: WorkspaceMetadata[] }
  | { Success: string }
  | { Error: string }
  | { WorkspaceNotInitialized: null }
  | { Members: User[] }
  | { Member: User }
  // Tree node responses
  | { Node: DomainNode }
  | { Nodes: DomainNode[] }
  | { TreeStructure: { root: TreeNode } }
  | { TreeSchema: TreeSchema }
  | { NodeTypes: CustomNodeType[] }
  | { NodeDeleted: { node_id: string; children_deleted: string[] } }
  | { NodeMoved: { node_id: string; old_parent_id: string | null; new_parent_id: string | null } };

export type UpdateOperation = "Add" | "Set" | "Remove";

export type ListType =
  | "MembersInWorkspace"
  | { MembersInDomain: { domain_id: string } };

export type PermissionEndowOperation = "Add" | "Remove" | "Replace";