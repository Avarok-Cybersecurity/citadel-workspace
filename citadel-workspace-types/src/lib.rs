pub mod structs;

use serde::{Deserialize, Serialize};
use structs::{Office, Permission, Room, User, UserRole, Workspace};
use ts_rs::TS;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WorkspaceProtocolRequest {
    // Workspace commands
    CreateWorkspace {
        name: String,
        description: String,
        workspace_master_password: String,
        metadata: Option<Vec<u8>>,
    },
    GetWorkspace,
    UpdateWorkspace {
        name: Option<String>,
        description: Option<String>,
        workspace_master_password: String,
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
        mdx_content: Option<String>,
        metadata: Option<Vec<u8>>,
    },
    GetOffice {
        office_id: String,
    },
    UpdateOffice {
        office_id: String,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
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
        mdx_content: Option<String>,
        metadata: Option<Vec<u8>>,
    },
    GetRoom {
        room_id: String,
    },
    UpdateRoom {
        room_id: String,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
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
        metadata: Option<Vec<u8>>,
    },
    GetMember {
        user_id: String,
    },
    UpdateMemberRole {
        user_id: String,
        role: UserRole,
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
    Message {
        // UI can inscribe whatever subprotocol it wishes on this for e.g., the actual message contents,
        // read receipts, typing indicators, etc, likely using an enum.
        contents: Vec<u8>,
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
