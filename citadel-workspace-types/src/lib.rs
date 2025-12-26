pub mod structs;

use serde::{Deserialize, Serialize};
use structs::{Office, Permission, Room, User, UserRole, Workspace};
use ts_rs::TS;
use custom_debug::Debug;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolPayload {
    Request(WorkspaceProtocolRequest),
    Response(WorkspaceProtocolResponse),
}

impl From<WorkspaceProtocolRequest> for WorkspaceProtocolPayload {
    fn from(request: WorkspaceProtocolRequest) -> Self {
        WorkspaceProtocolPayload::Request(request)
    }
}

impl From<WorkspaceProtocolResponse> for WorkspaceProtocolPayload {
    fn from(response: WorkspaceProtocolResponse) -> Self {
        WorkspaceProtocolPayload::Response(response)
    }
}

pub fn bytes_opt_debug_fmt<T: std::fmt::Debug + AsRef<[u8]>>(val: &Option<T>, f: &mut std::fmt::Formatter) -> std::fmt::Result {
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
    GetWorkspace,
    UpdateWorkspace {
        name: Option<String>,
        description: Option<String>,
        workspace_master_password: String,
        #[debug(with = bytes_opt_debug_fmt)]
        metadata: Option<Vec<u8>>,
    },
    DeleteWorkspace {
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolResponse {
    Workspace(Workspace),
    // Removing Workspaces variant since there's only one workspace
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
    pub timestamp: u64,
    /// ID of parent message if this is a thread reply
    pub reply_to: Option<String>,
    /// Number of replies to this message
    pub reply_count: u32,
    /// List of mentioned usernames
    pub mentions: Vec<String>,
    /// Unix timestamp of last edit (None if never edited)
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
