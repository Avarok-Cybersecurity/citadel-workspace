//! The requests that read and edit a workspace's role table, and how a member's role is named
//! on the wire.

use crate::roles::WorkspaceRoles;
use crate::structs::{Permission, UserRole};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A role as `AddMember` and `UpdateMemberRole` name it: a role id from the table, or a legacy
/// enum role.
///
/// Untagged, so the request a client sent before the table existed (`"role": "Admin"`) still
/// decodes, as `Legacy`, while a current client sends the id (`"role": "admin"`). The two never
/// collide: built-in ids are lower-case and the enum's names are not, and created roles get a
/// generated `role-` id. `Legacy(Banned)` is how a member is banned; Banned is a standing, not a
/// role in the table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum MemberRole {
    Legacy(UserRole),
    Id(String),
}

/// One change to a role. `Update` carries only the changes the editor made, so two
/// administrators editing different fields of one role do not overwrite each other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RoleChange {
    Rename(String),
    /// `None` returns the role to the default badge colour.
    Recolor(Option<String>),
    Move(u16),
    Grant(Vec<Permission>),
    Revoke(Vec<Permission>),
    /// Make this the role new members are given. Like assigning it: the caller must hold
    /// everything it carries.
    MakeDefault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RolesRequest {
    /// Any member.
    List,
    /// `ManageRoles`, below the caller's own position, holding nothing the caller lacks.
    Create {
        name: String,
        permissions: Vec<Permission>,
        position: u16,
        color: Option<String>,
    },
    /// `ManageRoles`, on a role below the caller's own. The Owner role cannot be changed.
    Update {
        id: String,
        changes: Vec<RoleChange>,
    },
    /// `ManageRoles`, on a role below the caller's own. Every holder moves to `reassign_to`,
    /// which the caller must be able to assign. Required, so nobody's role is chosen for them.
    /// Deleting the default role makes `reassign_to` the default, so it cannot be the Owner.
    Delete { id: String, reassign_to: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RolesResponse {
    /// The table, Owner first.
    Roles(WorkspaceRoles),
    /// The table after `role_id` was created, changed or deleted. Sent to the caller and
    /// announced to every member, whose permissions may have moved with it.
    RoleChanged {
        role_id: String,
        roles: WorkspaceRoles,
    },
}

impl From<UserRole> for MemberRole {
    fn from(role: UserRole) -> Self {
        MemberRole::Legacy(role)
    }
}
