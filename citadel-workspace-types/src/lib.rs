pub mod structs;

use custom_debug::Debug;
use serde::{Deserialize, Serialize};
use structs::{
    CustomNodeType, DomainNode, NodeEntityType, Office, Permission, Room, TreeNode, TreeSchema,
    User, UserRole, Workspace, WorkspaceMetadata,
};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolPayload {
    Request(WorkspaceProtocolRequest),
    Response(Box<WorkspaceProtocolResponse>),
}

impl From<WorkspaceProtocolRequest> for WorkspaceProtocolPayload {
    fn from(request: WorkspaceProtocolRequest) -> Self {
        WorkspaceProtocolPayload::Request(request)
    }
}

impl From<WorkspaceProtocolResponse> for WorkspaceProtocolPayload {
    fn from(response: WorkspaceProtocolResponse) -> Self {
        WorkspaceProtocolPayload::Response(Box::new(response))
    }
}

pub fn bytes_opt_debug_fmt<T: std::fmt::Debug + AsRef<[u8]>>(
    val: &Option<T>,
    f: &mut std::fmt::Formatter,
) -> std::fmt::Result {
    if let Some(val) = val {
        citadel_internal_service_types::bytes_debug_fmt(val, f)
    } else {
        write!(f, "None")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolRequest {
    // Workspace commands
    CreateWorkspace {
        name: String,
        description: String,
        workspace_master_password: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    GetWorkspace {
        /// Workspace ID to retrieve. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
    },
    /// List all workspaces the requesting user has access to
    ListWorkspaces,
    UpdateWorkspace {
        /// Workspace ID to update. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
        name: Option<String>,
        description: Option<String>,
        workspace_master_password: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    DeleteWorkspace {
        /// Workspace ID to delete. None defaults to the sentinel workspace-root.
        workspace_id: Option<String>,
        workspace_master_password: String,
    },

    // Office commands
    CreateOffice {
        workspace_id: String,
        name: String,
        description: String,
        #[debug(with = bytes_opt_debug_fmt)]
        mdx_content: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
        /// Whether this should be the default office (only one allowed per workspace)
        is_default: Option<bool>,
    },
    GetOffice {
        office_id: String,
    },
    UpdateOffice {
        office_id: String,
        name: Option<String>,
        description: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        mdx_content: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
        /// Set this office as the default (clears default on other offices)
        is_default: Option<bool>,
    },
    DeleteOffice {
        office_id: String,
    },
    ListOffices,

    // Room commands
    CreateRoom {
        office_id: String,
        name: String,
        description: String,
        #[debug(with = bytes_opt_debug_fmt)]
        mdx_content: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    GetRoom {
        room_id: String,
    },
    UpdateRoom {
        room_id: String,
        name: Option<String>,
        description: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        mdx_content: Option<String>,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    DeleteRoom {
        room_id: String,
    },
    ListRooms {
        office_id: String,
    },

    // Member commands
    AddMember {
        user_id: String,
        office_id: Option<String>,
        room_id: Option<String>,
        role: UserRole,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    GetMember {
        user_id: String,
    },
    UpdateMemberRole {
        user_id: String,
        role: UserRole,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    UpdateMemberPermissions {
        user_id: String,
        domain_id: String,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    },
    RemoveMember {
        user_id: String,
        office_id: Option<String>,
        room_id: Option<String>,
    },
    ListMembers {
        office_id: Option<String>,
        room_id: Option<String>,
    },
    /// Get a user's permissions for a specific domain
    GetUserPermissions {
        user_id: String,
        domain_id: String,
    },

    /// Update the current user's profile (name and/or avatar)
    UpdateUserProfile {
        /// New display name (optional)
        name: Option<String>,
        /// Base64-encoded avatar image data (WebP format, max 256x256)
        avatar_data: Option<String>,
    },

    Message {
        // UI can inscribe whatever subprotocol it wishes on this for e.g., the actual message contents,
        // read receipts, typing indicators, etc, likely using an enum.
        #[debug(with = citadel_internal_service_types::bytes_debug_fmt)]
        contents: Vec<u8>,
    },

    // ========== Group Messaging Commands ==========
    /// Send a message to a group chat channel (office or room)
    SendGroupMessage {
        /// UUID of the group chat channel (office.chat_channel_id or room.chat_channel_id)
        group_id: String,
        /// Type of message (text, markdown, system)
        message_type: GroupMessageType,
        /// Message content
        content: String,
        /// ID of message being replied to (for threading)
        reply_to: Option<String>,
        /// List of mentioned usernames
        mentions: Option<Vec<String>>,
    },

    /// Edit an existing group message
    EditGroupMessage {
        group_id: String,
        message_id: String,
        new_content: String,
    },

    /// Delete a group message
    DeleteGroupMessage {
        group_id: String,
        message_id: String,
    },

    /// Get paginated message history for a group
    GetGroupMessages {
        group_id: String,
        /// Get messages before this timestamp (for pagination)
        before_timestamp: Option<u64>,
        /// Maximum number of messages to return
        limit: Option<u32>,
    },

    /// Get all replies to a specific message (thread view)
    GetThreadMessages {
        group_id: String,
        /// The parent message ID
        parent_message_id: String,
    },

    // ========== Server Capabilities ==========
    /// Query server file transfer and storage capabilities.
    /// Returns configuration limits for RE-VFS storage, file transfers, etc.
    GetServerCapabilities,

    // ========== Generic Tree Node Operations ==========
    /// Create a new node in the workspace hierarchy tree.
    /// If parent_id is None, creates at workspace root level.
    CreateNode {
        parent_id: Option<String>,
        entity_type: NodeEntityType,
        name: String,
        description: String,
    },

    /// Get a specific node by ID
    GetNode {
        node_id: String,
    },

    /// Update an existing node's properties
    UpdateNode {
        node_id: String,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
        rules: Option<String>,
        chat_enabled: Option<bool>,
    },

    /// Delete a node. If cascade is true, also deletes all descendants.
    DeleteNode {
        node_id: String,
        cascade: bool,
    },

    /// Move a node to a new parent. If new_parent_id is None, moves to root level.
    MoveNode {
        node_id: String,
        new_parent_id: Option<String>,
    },

    /// List nodes with optional filtering.
    /// If parent_id is None, lists from workspace root.
    /// If depth is None or 0, returns only direct children.
    /// If entity_types is provided, filters to only those types.
    ListNodes {
        parent_id: Option<String>,
        depth: Option<u32>,
        entity_types: Option<Vec<NodeEntityType>>,
    },

    // ========== Tree Structure Operations ==========
    /// Get the full tree structure starting from a node.
    /// If root_id is None, starts from workspace root.
    /// max_depth limits how deep to traverse (None = unlimited).
    GetTreeStructure {
        root_id: Option<String>,
        max_depth: Option<u32>,
    },

    /// Get the current tree schema (nesting rules)
    GetTreeSchema,

    /// Update the tree schema (admin only)
    UpdateTreeSchema {
        schema: TreeSchema,
    },

    // ========== Custom Node Type Operations ==========
    /// Create a new custom node type
    CreateNodeType {
        name: String,
        display_name: String,
        icon: Option<String>,
        allowed_parents: Vec<String>,
    },

    /// List all available node types (built-in and custom)
    ListNodeTypes,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolResponse {
    Workspace(Workspace),
    /// List of workspaces the user has access to (for multi-workspace support)
    Workspaces(Vec<WorkspaceMetadata>),
    Success(String),
    Error(String),
    WorkspaceNotInitialized,
    Offices(Vec<Office>),
    Rooms(Vec<Room>),
    Members(Vec<User>),
    Office(Office),
    Room(Room),
    Member(User),
    /// Response containing a user's role and permissions for a domain
    UserPermissions {
        domain_id: String,
        user_id: String,
        role: UserRole,
        permissions: Vec<Permission>,
    },
    /// Confirmation that member role was updated
    MemberRoleUpdated {
        user_id: String,
        new_role: UserRole,
    },

    /// Response after user profile was updated
    UserProfileUpdated(User),

    /// Confirmation that an office was deleted
    DeleteOffice {
        office_id: String,
    },

    /// Confirmation that a room was deleted
    DeleteRoom {
        room_id: String,
    },

    // ========== Content Broadcast Responses ==========
    /// Notification that office content was updated (broadcast to all workspace members)
    OfficeContentUpdated {
        office_id: String,
        mdx_content: String,
        updated_by: String,
        #[ts(type = "bigint")]
        timestamp: u64,
    },

    /// Notification that room content was updated (broadcast to all workspace members)
    RoomContentUpdated {
        room_id: String,
        office_id: String,
        mdx_content: String,
        updated_by: String,
        #[ts(type = "bigint")]
        timestamp: u64,
    },

    // ========== Group Messaging Responses ==========
    /// Notification of a new group message (broadcast to all group members)
    GroupMessageNotification {
        group_id: String,
        message: GroupMessage,
    },

    /// Paginated list of group messages
    GroupMessages {
        group_id: String,
        messages: Vec<GroupMessage>,
        has_more: bool,
    },

    /// Notification that a message was edited
    GroupMessageEdited {
        group_id: String,
        message_id: String,
        new_content: String,
        #[ts(type = "bigint")]
        edited_at: u64,
    },

    /// Notification that a message was deleted
    GroupMessageDeleted {
        group_id: String,
        message_id: String,
        deleted_by: String,
    },

    /// Single group message response
    GroupMessage(GroupMessage),

    // ========== Server Capabilities Response ==========
    /// Server file transfer and storage capabilities
    ServerCapabilities {
        /// Whether server-mediated file transfers are enabled
        allow_server_file_transfer: bool,
        /// Whether RE-VFS (server-side encrypted storage) is enabled
        allow_server_revfs_storage: bool,
        /// Maximum file size for transfers (in megabytes)
        #[ts(type = "bigint")]
        max_file_transfer_size_mb: u64,
        /// RE-VFS storage quota per user (in megabytes)
        #[ts(type = "bigint")]
        revfs_storage_quota_mb: u64,
    },

    // ========== Tree Node Responses ==========
    /// Single node response
    Node(DomainNode),

    /// List of nodes response
    Nodes(Vec<DomainNode>),

    /// Full tree structure with nested children
    TreeStructure {
        root: TreeNode,
    },

    /// Tree schema (nesting rules) response
    TreeSchema(TreeSchema),

    /// List of available node types
    NodeTypes(Vec<CustomNodeType>),

    /// Confirmation that a node was deleted
    NodeDeleted {
        node_id: String,
        /// IDs of child nodes that were also deleted (if cascade was true)
        children_deleted: Vec<String>,
    },

    /// Confirmation that a node was moved
    NodeMoved {
        node_id: String,
        old_parent_id: Option<String>,
        new_parent_id: Option<String>,
    },
}

/// Type of group message
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub enum GroupMessageType {
    /// Plain text message
    Text,
    /// Markdown formatted message
    Markdown,
    /// System message (user joined, settings changed, etc.)
    System,
}

/// A message in a group chat channel
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GroupMessage {
    /// Unique message ID
    pub id: String,
    /// Group channel ID this message belongs to
    pub group_id: String,
    /// User ID of the sender
    pub sender_id: String,
    /// Display name of the sender
    pub sender_name: String,
    /// Type of message
    pub message_type: GroupMessageType,
    /// Message content
    pub content: String,
    /// Unix timestamp in milliseconds
    #[ts(type = "bigint")]
    pub timestamp: u64,
    /// ID of parent message if this is a thread reply
    pub reply_to: Option<String>,
    /// Number of replies to this message
    pub reply_count: u32,
    /// List of mentioned usernames
    pub mentions: Vec<String>,
    /// Unix timestamp of last edit (None if never edited)
    #[ts(type = "bigint | null")]
    pub edited_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum PermissionEndowOperation {
    // Adds the associated permissions to the user
    Add,
    // Removes the associated permissions from the user
    Remove,
    // Completely overwrites any existing permissions with the newly provided permissions
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ListType {
    MembersInWorkspace,
    MembersInOffice { office_id: String },
    MembersInRoom { room_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum UpdateOperation {
    // Adds the associated permissions to the user
    Add,
    // Sets the existing permissions to the new permissions. This overwrites any existing permissions
    Set,
    // Removes the associated permissions from the user
    Remove,
}
