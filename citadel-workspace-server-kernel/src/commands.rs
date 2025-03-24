use crate::structs::{Office, Permission, Room, User, UserRole};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PermissionEndowOperation {
    // Adds the associated permissions to the user
    Add,
    // Removes the associated permissions from the user
    Remove,
    // Completely overwrites any existing permissions with the newly provided permissions
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ListType {
    MembersInOffice { office_id: String },
    MembersInRoom { room_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UpdateOperation {
    Add,
    Remove,
    Set,
}

// Command protocol structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorkspaceCommand {
    // Office commands
    CreateOffice {
        name: String,
        description: String,
    },
    GetOffice {
        office_id: String,
    },
    UpdateOffice {
        office_id: String,
        name: Option<String>,
        description: Option<String>,
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
    },
    GetRoom {
        room_id: String,
    },
    UpdateRoom {
        room_id: String,
        name: Option<String>,
        description: Option<String>,
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
    },
    GetMember {
        user_id: String,
    },
    UpdateMemberRole {
        user_id: String,
        role: UserRole,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorkspaceResponse {
    Success,
    Error(String),
    Offices(Vec<Office>),
    Rooms(Vec<Room>),
    Members(Vec<User>),
    Office(Office),
    Room(Room),
    Member(User),
}
