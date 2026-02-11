use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt;
use ts_rs::TS;

// User management structures
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct User {
    pub id: String,
    pub name: String,
    pub role: UserRole,
    // Permissions are a map of domain IDs to sets of permissions
    pub permissions: HashMap<String, HashSet<Permission>>,
    pub metadata: HashMap<String, MetadataValue>,
}

impl User {
    /// Create a new user with the given role
    pub fn new(id: String, name: String, role: UserRole) -> Self {
        Self {
            id,
            name,
            role,
            permissions: HashMap::new(),
            metadata: HashMap::new(),
        }
    }

    /// Get permissions for a specific domain
    pub fn get_permissions<T: AsRef<str>>(&self, domain_id: T) -> Option<&HashSet<Permission>> {
        self.permissions.get(domain_id.as_ref())
    }

    /// Check if user is a member of a domain
    pub fn is_member_of_domain<T: AsRef<str>>(&self, domain_id: T) -> bool {
        self.permissions.contains_key(domain_id.as_ref())
    }

    /// Check if user has a specific permission in a domain
    pub fn has_permission<T: AsRef<str>>(&self, domain_id: T, permission: Permission) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_permission(perms, &permission)
        } else {
            false
        }
    }

    /// Check if user has all of the required permissions in a domain
    pub fn has_all_permissions<T: AsRef<str>>(
        &self,
        domain_id: T,
        required: &[Permission],
    ) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_all_permissions(perms, required)
        } else {
            false
        }
    }

    /// Check if user has any of the specified permissions in a domain
    pub fn has_any_permission<T: AsRef<str>>(&self, domain_id: T, required: &[Permission]) -> bool {
        if let Some(perms) = self.get_permissions(domain_id) {
            Permission::has_any_permission(perms, required)
        } else {
            false
        }
    }

    /// Check if user has administrator role
    pub fn is_administrator(&self) -> bool {
        matches!(self.role, UserRole::Admin)
    }

    /// Grant a permission to the user for a specific domain
    pub fn grant_permission<T: Into<String>>(&mut self, domain_id: T, permission: Permission) {
        // Use into() which is more efficient for owned strings and only clones when necessary
        self.permissions
            .entry(domain_id.into())
            .or_default()
            .insert(permission);
    }

    /// Add a permission to the user for a specific domain (alias for grant_permission)
    pub fn add_permission<T: Into<String>>(&mut self, domain_id: T, permission: Permission) {
        self.grant_permission(domain_id, permission);
    }

    /// Revoke a permission from the user for a specific domain
    pub fn revoke_permission<T: AsRef<str>>(&mut self, domain_id: T, permission: Permission) {
        if let Some(perms) = self.permissions.get_mut(domain_id.as_ref()) {
            perms.remove(&permission);
        }
    }

    /// Clear all permissions for a specific domain
    pub fn clear_permissions<T: AsRef<str>>(&mut self, domain_id: T) {
        self.permissions.remove(domain_id.as_ref());
    }

    /// Set all permissions for a domain based on the user's role
    pub fn set_role_permissions<T: AsRef<str> + Into<String>>(&mut self, domain_id: T) {
        let role_permissions = Permission::for_role(&self.role);
        self.permissions.insert(domain_id.into(), role_permissions);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
#[allow(dead_code)]
pub enum UserRole {
    Admin,
    Owner,
    Member,
    Guest,
    Banned,
    Custom(String, u8),
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "Admin"),
            UserRole::Owner => write!(f, "Owner"),
            UserRole::Member => write!(f, "Member"),
            UserRole::Guest => write!(f, "Guest"),
            UserRole::Banned => write!(f, "Banned"),
            UserRole::Custom(name, _) => write!(f, "{}", name),
        }
    }
}

const ADMIN_RANK: u8 = u8::MAX;
const OWNER_RANK: u8 = 20;
const MEMBER_RANK: u8 = 10;
const GUEST_RANK: u8 = 5;
const BANNED_RANK: u8 = 0;

// Custom role thresholds
const CUSTOM_BASIC_THRESHOLD: u8 = 10;
const CUSTOM_EDITOR_THRESHOLD: u8 = 15;

pub struct WorkspaceRoles {
    // Mapping from the name to the user role
    pub roles: HashMap<String, UserRole>,
}

impl WorkspaceRoles {
    pub fn new() -> Self {
        Self {
            roles: vec![
                UserRole::Admin,
                UserRole::Owner,
                UserRole::Member,
                UserRole::Guest,
                UserRole::Banned,
            ]
            .into_iter()
            .map(|role| (role.to_string(), role))
            .collect(),
        }
    }
}

impl Default for WorkspaceRoles {
    fn default() -> Self {
        Self::new()
    }
}

impl UserRole {
    pub fn get_rank(&self) -> u8 {
        match self {
            UserRole::Admin => ADMIN_RANK,
            UserRole::Owner => OWNER_RANK,
            UserRole::Member => MEMBER_RANK,
            UserRole::Guest => GUEST_RANK,
            UserRole::Banned => BANNED_RANK,
            UserRole::Custom(_, rank) => *rank,
        }
    }

    /// Creates a custom user role with a given name and rank.
    pub fn create_custom_role(name: String, rank: u8) -> Option<Self> {
        if rank == ADMIN_RANK
            || rank == OWNER_RANK
            || rank == MEMBER_RANK
            || rank == GUEST_RANK
            || rank == BANNED_RANK
        {
            return None;
        }

        Some(UserRole::Custom(name, rank))
    }
}

impl Ord for UserRole {
    fn cmp(&self, other: &Self) -> Ordering {
        self.get_rank().cmp(&other.get_rank())
    }
}

impl PartialOrd for UserRole {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub enum Permission {
    /// All permissions
    All,
    /// Create a child node (office, room, etc.)
    CreateNode,
    /// Delete a child node
    DeleteNode,
    /// Update a child node
    UpdateNode,
    /// Create a workspace
    CreateWorkspace,
    /// Update a workspace
    UpdateWorkspace,
    /// Delete a workspace
    DeleteWorkspace,
    /// Edit content
    EditContent,
    /// Add users
    AddUsers,
    /// Remove users
    RemoveUsers,
    /// Edit MDX content
    EditMdx,
    /// Edit node configuration
    EditNodeConfig,
    /// Add a node to a parent
    AddNode,
    /// Update node settings
    UpdateNodeSettings,
    /// View content
    ViewContent,
    /// Manage node members
    ManageNodeMembers,
    /// Send messages
    SendMessages,
    /// Read messages
    ReadMessages,
    /// Upload files
    UploadFiles,
    /// Download files
    DownloadFiles,
    /// Manage domains (admin permission)
    ManageDomains,
    /// Configure system (admin permission)
    ConfigureSystem,
    /// Edit workspace configuration
    EditWorkspaceConfig,
    /// Ban a user from a domain
    BanUser,
    /// Edit tree structure (add/remove/rearrange nodes)
    EditTreeStructure,
    /// Manage custom node types
    ManageNodeTypes,
}

impl Permission {
    /// Get a set of permissions for a specific role
    pub fn for_role(role: &UserRole) -> HashSet<Self> {
        let mut permissions = HashSet::new();

        match role {
            UserRole::Admin => {
                permissions.insert(Self::All);
            }
            UserRole::Owner => {
                permissions.insert(Self::EditContent);
                permissions.insert(Self::AddUsers);
                permissions.insert(Self::RemoveUsers);
                permissions.insert(Self::CreateNode);
                permissions.insert(Self::DeleteNode);
                permissions.insert(Self::CreateWorkspace);
                permissions.insert(Self::DeleteWorkspace);
                permissions.insert(Self::EditTreeStructure);
                permissions.insert(Self::ManageNodeTypes);
            }
            UserRole::Member => {
                // Basic member permissions
                // Note: Members do NOT have EditContent - that requires Owner or Admin role
                permissions.insert(Self::ViewContent);
                permissions.insert(Self::SendMessages);
                permissions.insert(Self::ReadMessages);
                permissions.insert(Self::UploadFiles);
                permissions.insert(Self::DownloadFiles);
            }
            UserRole::Guest => {
                // Guest permissions - read-only access
                permissions.insert(Self::ViewContent);
            }
            UserRole::Banned => {
                // No permissions for banned users
            }
            UserRole::Custom(_, rank) => {
                // Custom role permissions based on rank
                // Basic permissions for all custom roles
                permissions.insert(Self::ViewContent);
                permissions.insert(Self::ReadMessages);

                // Additional permissions based on rank
                if *rank > CUSTOM_BASIC_THRESHOLD {
                    permissions.insert(Self::EditContent);
                    permissions.insert(Self::SendMessages);
                    permissions.insert(Self::UploadFiles);
                    permissions.insert(Self::DownloadFiles);
                }

                if *rank > CUSTOM_EDITOR_THRESHOLD {
                    permissions.insert(Self::AddUsers);
                    permissions.insert(Self::RemoveUsers);
                    permissions.insert(Self::EditMdx);
                }
            }
        }

        permissions
    }

    /// Check if a permission set has a specific permission
    pub fn has_permission(permissions: &HashSet<Self>, permission: &Self) -> bool {
        permissions.contains(&Self::All) || permissions.contains(permission)
    }

    /// Check if a permission set has all of the specified permissions
    pub fn has_all_permissions(permissions: &HashSet<Self>, required: &[Self]) -> bool {
        if permissions.contains(&Self::All) {
            return true;
        }

        required.iter().all(|p| permissions.contains(p))
    }

    /// Check if a permission set has any of the specified permissions
    pub fn has_any_permission(permissions: &HashSet<Self>, required: &[Self]) -> bool {
        if permissions.contains(&Self::All) {
            return true;
        }

        required.iter().any(|p| permissions.contains(p))
    }
}

/// Default permissions for a domain node.
/// These define what actions are allowed by default for users in that node.
/// Read operations default to `true`, write/admin operations default to `false`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub struct DomainPermissions {
    // === Read Permissions (default: true) ===
    /// Whether users can view content in this domain
    pub view_content: bool,
    /// Whether users can read messages in group chat
    pub read_messages: bool,
    /// Whether users can download files
    pub download_files: bool,

    // === Write Permissions (default: false) ===
    /// Whether users can edit content (documents, etc.)
    pub edit_content: bool,
    /// Whether users can edit MDX content
    pub edit_mdx: bool,
    /// Whether users can send messages in group chat
    pub send_messages: bool,
    /// Whether users can upload files
    pub upload_files: bool,

    // === Node Management (default: false) ===
    /// Whether users can create child nodes
    pub create_node: bool,
    /// Whether users can delete child nodes
    pub delete_node: bool,
    /// Whether users can update child nodes
    pub update_node: bool,
    /// Whether users can add child nodes
    pub add_node: bool,
    /// Whether users can edit node configuration
    pub edit_node_config: bool,
    /// Whether users can update node settings
    pub update_node_settings: bool,
    /// Whether users can manage node members
    pub manage_node_members: bool,

    // === Workspace Management (default: false) ===
    /// Whether users can create workspaces
    pub create_workspace: bool,
    /// Whether users can update workspaces
    pub update_workspace: bool,
    /// Whether users can delete workspaces
    pub delete_workspace: bool,
    /// Whether users can edit workspace configuration
    pub edit_workspace_config: bool,

    // === User Management (default: false) ===
    /// Whether users can add other users to this domain
    pub add_users: bool,
    /// Whether users can remove users from this domain
    pub remove_users: bool,
    /// Whether users can ban users from this domain
    pub ban_user: bool,

    // === System/Admin (default: false) ===
    /// Whether users can manage domains
    pub manage_domains: bool,
    /// Whether users can configure system settings
    pub configure_system: bool,

    // === Tree Structure (default: false) ===
    /// Whether users can edit tree structure (add/remove/rearrange nodes)
    pub edit_tree_structure: bool,
    /// Whether users can manage custom node types
    pub manage_node_types: bool,
}

impl Default for DomainPermissions {
    fn default() -> Self {
        Self {
            // Read permissions - enabled by default
            view_content: true,
            read_messages: true,
            download_files: true,

            // Write permissions - disabled by default
            edit_content: false,
            edit_mdx: false,
            send_messages: false,
            upload_files: false,

            // Node management - disabled by default
            create_node: false,
            delete_node: false,
            update_node: false,
            add_node: false,
            edit_node_config: false,
            update_node_settings: false,
            manage_node_members: false,

            // Workspace management - disabled by default
            create_workspace: false,
            update_workspace: false,
            delete_workspace: false,
            edit_workspace_config: false,

            // User management - disabled by default
            add_users: false,
            remove_users: false,
            ban_user: false,

            // System/Admin - disabled by default
            manage_domains: false,
            configure_system: false,

            // Tree structure - disabled by default
            edit_tree_structure: false,
            manage_node_types: false,
        }
    }
}

impl DomainPermissions {
    /// Create a new DomainPermissions with default values
    pub fn new() -> Self {
        Self::default()
    }

    /// Create permissions with all read access enabled
    pub fn read_only() -> Self {
        Self::default()
    }

    /// Create permissions with read and basic write access (for members)
    pub fn member_access() -> Self {
        Self {
            edit_content: true,
            edit_mdx: true,
            send_messages: true,
            upload_files: true,
            ..Self::default()
        }
    }

    /// Create permissions with full access (for admins/owners)
    pub fn full_access() -> Self {
        Self {
            view_content: true,
            read_messages: true,
            download_files: true,
            edit_content: true,
            edit_mdx: true,
            send_messages: true,
            upload_files: true,
            create_node: true,
            delete_node: true,
            update_node: true,
            add_node: true,
            edit_node_config: true,
            update_node_settings: true,
            manage_node_members: true,
            create_workspace: true,
            update_workspace: true,
            delete_workspace: true,
            edit_workspace_config: true,
            add_users: true,
            remove_users: true,
            ban_user: true,
            manage_domains: true,
            configure_system: true,
            edit_tree_structure: true,
            manage_node_types: true,
        }
    }

    /// Check if a specific permission is granted
    pub fn has_permission(&self, permission: &Permission) -> bool {
        match permission {
            Permission::All => {
                self.view_content
                    && self.read_messages
                    && self.download_files
                    && self.edit_content
                    && self.send_messages
                    && self.upload_files
                    && self.create_node
                    && self.delete_node
                    && self.manage_domains
                    && self.configure_system
            }
            Permission::ViewContent => self.view_content,
            Permission::ReadMessages => self.read_messages,
            Permission::DownloadFiles => self.download_files,
            Permission::EditContent => self.edit_content,
            Permission::EditMdx => self.edit_mdx,
            Permission::SendMessages => self.send_messages,
            Permission::UploadFiles => self.upload_files,
            Permission::CreateNode => self.create_node,
            Permission::DeleteNode => self.delete_node,
            Permission::UpdateNode => self.update_node,
            Permission::AddNode => self.add_node,
            Permission::EditNodeConfig => self.edit_node_config,
            Permission::UpdateNodeSettings => self.update_node_settings,
            Permission::ManageNodeMembers => self.manage_node_members,
            Permission::CreateWorkspace => self.create_workspace,
            Permission::UpdateWorkspace => self.update_workspace,
            Permission::DeleteWorkspace => self.delete_workspace,
            Permission::EditWorkspaceConfig => self.edit_workspace_config,
            Permission::AddUsers => self.add_users,
            Permission::RemoveUsers => self.remove_users,
            Permission::BanUser => self.ban_user,
            Permission::ManageDomains => self.manage_domains,
            Permission::ConfigureSystem => self.configure_system,
            Permission::EditTreeStructure => self.edit_tree_structure,
            Permission::ManageNodeTypes => self.manage_node_types,
        }
    }
}

// =============================================================================
// GENERALIZED TREE HIERARCHY TYPES
// =============================================================================
// The workspace hierarchy uses an arbitrary-depth tree structure where:
// - Root is always Workspace (depth 0, special case)
// - All children are Child(String) type (e.g., "Office", "Room", "Department")
// - Default tree: Workspace → Child("Office") → Child("Room")
// - Permission inheritance works at any depth

/// Entity type for nodes in the workspace hierarchy tree.
/// Workspace is special (root only), all other nodes are Child types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[ts(export)]
pub enum NodeEntityType {
    /// Root node only - the workspace itself
    Workspace,
    /// Any child node type: "Office", "Room", "Department", "Team", etc.
    Child(String),
}

impl NodeEntityType {
    /// Check if this is the root workspace type
    pub fn is_workspace(&self) -> bool {
        matches!(self, NodeEntityType::Workspace)
    }

    /// Check if this is a child type with the given name
    pub fn is_child_of_type(&self, type_name: &str) -> bool {
        matches!(self, NodeEntityType::Child(name) if name == type_name)
    }

    /// Get the type name as a string
    pub fn type_name(&self) -> &str {
        match self {
            NodeEntityType::Workspace => "Workspace",
            NodeEntityType::Child(name) => name,
        }
    }
}

impl fmt::Display for NodeEntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NodeEntityType::Workspace => write!(f, "Workspace"),
            NodeEntityType::Child(name) => write!(f, "{}", name),
        }
    }
}

/// A unified node in the workspace hierarchy tree.
/// Replaces the separate Workspace/Office/Room structs with a single generalized type.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DomainNode {
    /// Unique identifier for this node
    pub id: String,
    /// Parent node ID. None = this is the workspace root
    pub parent_id: Option<String>,
    /// Type of this node (Workspace or Child("Office"), Child("Room"), etc.)
    pub entity_type: NodeEntityType,
    /// Depth in the tree (0=workspace root, 1=office-level, 2=room-level, etc.)
    pub depth: u32,

    // Core properties
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>,
    /// IDs of child nodes
    pub children: Vec<String>,

    // Content
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub mdx_content: String,
    /// Rules displayed to users
    pub rules: Option<String>,
    /// Whether group chat is enabled for this node
    pub chat_enabled: bool,
    /// UUID for the group chat channel (assigned when chat_enabled is true)
    pub chat_channel_id: Option<String>,
    /// Default permissions for users in this node
    pub default_permissions: DomainPermissions,
    /// Flexible metadata for frontend use
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub metadata: Vec<u8>,

    // Schema constraints
    /// If set, only these child types are allowed under this node
    pub allowed_child_types: Option<Vec<String>>,
    /// Whether this is the default node at its level (navigated to on login)
    pub is_default: bool,

    pub created_at: u64,
    pub updated_at: u64,
}

impl DomainNode {
    /// Check if this node is the workspace root
    pub fn is_root(&self) -> bool {
        self.parent_id.is_none() && self.entity_type.is_workspace()
    }

    /// Check if this node can have children of the given type
    pub fn can_have_child_type(&self, child_type: &str) -> bool {
        match &self.allowed_child_types {
            Some(allowed) => allowed.iter().any(|t| t == child_type),
            None => true, // No restrictions
        }
    }
}

/// Recursive tree structure for representing the full hierarchy
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TreeNode {
    pub node: DomainNode,
    pub children: Vec<TreeNode>,
}

/// Rule defining what child types are allowed under a parent type
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NestingRule {
    /// Parent node type (use "Workspace" for root, or child type names)
    pub parent_type: String,
    /// Allowed child type names under this parent
    pub allowed_child_types: Vec<String>,
}

/// Display configuration for an entity type (icon, labels, placeholders).
/// Sent as part of TreeSchema so the frontend can derive all display metadata
/// from a single source of truth.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EntityTypeConfig {
    /// Entity type name (e.g., "Workspace", "Office", "Room")
    pub type_name: String,
    /// Lucide icon name in kebab-case (e.g., "building-2", "briefcase", "message-square")
    pub icon: String,
    /// Singular display label (e.g., "Office")
    pub label: String,
    /// Plural display label (e.g., "Offices")
    pub plural_label: String,
    /// Name field placeholder (e.g., "e.g., Engineering, Marketing, HR")
    pub name_placeholder: String,
    /// Description field placeholder
    pub description_placeholder: String,
}

/// Schema defining the structure rules for a workspace tree
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TreeSchema {
    pub id: String,
    pub name: String,
    /// Nesting rules defining valid parent-child relationships
    pub rules: Vec<NestingRule>,
    /// Maximum allowed depth (None = unlimited)
    pub max_depth: Option<u32>,
    /// Display configs for each entity type (icons, labels, placeholders)
    #[serde(default)]
    pub entity_type_configs: Vec<EntityTypeConfig>,
}

impl Default for TreeSchema {
    /// Default schema: Workspace → Office → Room (traditional 3-level hierarchy)
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            name: "Default Schema".to_string(),
            rules: vec![
                NestingRule {
                    parent_type: "Workspace".to_string(),
                    allowed_child_types: vec!["Office".to_string()],
                },
                NestingRule {
                    parent_type: "Office".to_string(),
                    allowed_child_types: vec!["Room".to_string()],
                },
                NestingRule {
                    parent_type: "Room".to_string(),
                    allowed_child_types: vec![], // Rooms are leaf nodes by default
                },
            ],
            max_depth: Some(3), // Workspace(0) → Office(1) → Room(2)
            entity_type_configs: vec![
                EntityTypeConfig {
                    type_name: "Workspace".to_string(),
                    icon: "building-2".to_string(),
                    label: "Workspace".to_string(),
                    plural_label: "Workspaces".to_string(),
                    name_placeholder: "e.g., Avarok Cybersecurity".to_string(),
                    description_placeholder: "Describe the purpose of this workspace...".to_string(),
                },
                EntityTypeConfig {
                    type_name: "Office".to_string(),
                    icon: "briefcase".to_string(),
                    label: "Office".to_string(),
                    plural_label: "Offices".to_string(),
                    name_placeholder: "e.g., Engineering, Marketing, HR".to_string(),
                    description_placeholder: "Describe the purpose of this office...".to_string(),
                },
                EntityTypeConfig {
                    type_name: "Room".to_string(),
                    icon: "message-square".to_string(),
                    label: "Room".to_string(),
                    plural_label: "Rooms".to_string(),
                    name_placeholder: "e.g., General, Design Reviews, Standups".to_string(),
                    description_placeholder: "Describe the purpose of this room...".to_string(),
                },
            ],
        }
    }
}

impl TreeSchema {
    /// Check if a child type is allowed under the given parent type.
    /// If no rules are defined for the parent type, allows all child types by default.
    pub fn is_child_allowed(&self, parent_type: &str, child_type: &str) -> bool {
        // If no rules are defined at all, allow everything
        if self.rules.is_empty() {
            return true;
        }

        self.rules
            .iter()
            .find(|r| r.parent_type == parent_type)
            .map(|r| r.allowed_child_types.contains(&child_type.to_string()))
            // If no rule exists for this parent type, allow all children by default
            .unwrap_or(true)
    }

    /// Get allowed child types for a parent type
    pub fn get_allowed_children(&self, parent_type: &str) -> Vec<String> {
        self.rules
            .iter()
            .find(|r| r.parent_type == parent_type)
            .map(|r| r.allowed_child_types.clone())
            .unwrap_or_default()
    }
}

/// Custom node type definition for user-created types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CustomNodeType {
    /// Internal name (e.g., "Department", "Team")
    pub name: String,
    /// Display name shown in UI
    pub display_name: String,
    /// Optional icon identifier
    pub icon: Option<String>,
    /// Which parent types can contain this type
    pub allowed_parents: Vec<String>,
}

// =============================================================================
// END GENERALIZED TREE HIERARCHY TYPES
// =============================================================================

/// Metadata field for storing flexible data used by the frontend
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct MetadataField {
    pub key: String,
    pub value: MetadataValue,
}

/// Value types for metadata fields
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
#[serde(tag = "type", content = "content")]
pub enum MetadataValue {
    String(String),
    Number(f64),
    Boolean(bool),
    Array(Vec<MetadataValue>),
    Object(HashMap<String, MetadataValue>),
    Null,
}

/// A workspace is a container for offices
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    pub members: Vec<String>,
    pub offices: Vec<String>,
    #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
    pub metadata: Vec<u8>,
}

impl Workspace {
    // ...
}

/// Lightweight workspace metadata for listing multiple workspaces.
/// Excludes large fields like office lists to reduce payload size.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct WorkspaceMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub owner_id: String,
    /// Whether this is the default (sentinel) workspace
    pub is_default: bool,
    pub member_count: u32,
}

impl From<&Workspace> for WorkspaceMetadata {
    fn from(ws: &Workspace) -> Self {
        Self {
            id: ws.id.clone(),
            name: ws.name.clone(),
            description: ws.description.clone(),
            owner_id: ws.owner_id.clone(),
            is_default: ws.id == "workspace-root",
            member_count: ws.members.len() as u32,
        }
    }
}

/// Domain storage for workspace-level entities.
/// Office and Room entities are now stored as DomainNodes in the tree hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Domain {
    Workspace { workspace: Workspace },
}

impl Domain {
    pub fn id(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.name,
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.description,
        }
    }

    pub fn owner_id(&self) -> &str {
        match self {
            Domain::Workspace { workspace } => &workspace.owner_id,
        }
    }

    pub fn members(&self) -> &Vec<String> {
        match self {
            Domain::Workspace { workspace } => &workspace.members,
        }
    }

    pub fn update_name(&mut self, name: String) {
        match self {
            Domain::Workspace { workspace } => workspace.name = name,
        }
    }

    pub fn update_description(&mut self, description: String) {
        match self {
            Domain::Workspace { workspace } => workspace.description = description,
        }
    }

    pub fn set_members(&mut self, members: Vec<String>) {
        match self {
            Domain::Workspace { workspace } => workspace.members = members,
        }
    }

    pub fn as_workspace(&self) -> Option<&Workspace> {
        match self {
            Domain::Workspace { workspace } => Some(workspace),
        }
    }

    pub fn as_workspace_mut(&mut self) -> Option<&mut Workspace> {
        match self {
            Domain::Workspace { workspace } => Some(workspace),
        }
    }
}
