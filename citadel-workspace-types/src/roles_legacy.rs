//! Reading member records written before roles were editable.
//!
//! Such a record names its role with the `UserRole` enum and has no `workspace_roles`. It also
//! carries a copy of that role's permissions in `permissions[workspace root]`: the old role write
//! materialised them there. That copy has to go, because a direct grant is honoured before the
//! role, so it would keep conferring the old set after an administrator edited the role.

use crate::roles::{ADMIN_ROLE_ID, GUEST_ROLE_ID, MEMBER_ROLE_ID, OWNER_ROLE_ID};
use crate::structs::{Permission, User, UserRole};
use crate::WORKSPACE_ROOT_ID;
use std::collections::HashSet;

/// The built-in role id a legacy enum role became. `None` for Banned, which is a standing.
///
/// Custom roles were never offered by any client and have no counterpart in the table; they
/// become Member, the role with no administrative reach, and the caller logs it.
pub fn legacy_role_id(role: &UserRole) -> Option<&'static str> {
    match role {
        UserRole::Owner => Some(OWNER_ROLE_ID),
        UserRole::Admin => Some(ADMIN_ROLE_ID),
        UserRole::Member | UserRole::Custom(_, _) => Some(MEMBER_ROLE_ID),
        UserRole::Guest => Some(GUEST_ROLE_ID),
        UserRole::Banned => None,
    }
}

/// The enum a built-in role id is written back as, for clients that predate the table and read
/// only `User::role`. A created role has no enum, so it is named by a `Custom` carrying its
/// name. Never read for authority: the role id is.
pub fn legacy_mirror(role_id: &str, role_name: &str) -> UserRole {
    match role_id {
        OWNER_ROLE_ID => UserRole::Owner,
        ADMIN_ROLE_ID => UserRole::Admin,
        MEMBER_ROLE_ID => UserRole::Member,
        GUEST_ROLE_ID => UserRole::Guest,
        _ => UserRole::Custom(role_name.to_string(), 0),
    }
}

/// What reading a legacy record changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyRoleRead {
    /// Already current, or Banned: nothing to map.
    Current,
    /// Mapped from the enum to `role_id`.
    Mapped { role_id: &'static str },
    /// A `Custom` role, mapped to Member. Worth a warning: its holder may have had more.
    CustomBecameMember { name: String },
}

impl User {
    /// Bring a record written before the role table up to date. Idempotent: a record that
    /// already names its root role is returned unchanged.
    pub fn read_legacy_role(&mut self) -> LegacyRoleRead {
        if self.workspace_roles.contains_key(WORKSPACE_ROOT_ID) {
            return LegacyRoleRead::Current;
        }
        let Some(role_id) = legacy_role_id(&self.role) else {
            return LegacyRoleRead::Current;
        };

        let materialised = Permission::for_legacy_role(&self.role);
        if let Some(root) = self.permissions.get_mut(WORKSPACE_ROOT_ID) {
            root.retain(|permission| !materialised.contains(permission));
            if root.is_empty() {
                self.permissions.remove(WORKSPACE_ROOT_ID);
            }
        }
        self.workspace_roles
            .insert(WORKSPACE_ROOT_ID.to_string(), role_id.to_string());

        match &self.role {
            UserRole::Custom(name, _) => LegacyRoleRead::CustomBecameMember { name: name.clone() },
            _ => LegacyRoleRead::Mapped { role_id },
        }
    }
}

impl Permission {
    /// What a legacy enum role conferred. Read only to recognise the copy the old role write
    /// left in a record; the built-ins come from `seed_roles`, which this defers to.
    pub fn for_legacy_role(role: &UserRole) -> HashSet<Self> {
        match role {
            UserRole::Banned => HashSet::new(),
            UserRole::Custom(_, rank) => legacy_custom_permissions(*rank),
            _ => legacy_role_id(role)
                .and_then(|id| {
                    crate::roles::seed_roles()
                        .into_iter()
                        .find(|role| role.id == id)
                })
                .map(|role| role.permissions)
                .unwrap_or_default(),
        }
    }
}

/// The rank formula Custom roles used.
fn legacy_custom_permissions(rank: u8) -> HashSet<Permission> {
    use Permission::*;
    let mut permissions: HashSet<Permission> = [ViewContent, ViewMembers, ReadMessages]
        .into_iter()
        .collect();
    if rank > 10 {
        permissions.extend([EditContent, SendMessages, UploadFiles, DownloadFiles]);
    }
    if rank > 15 {
        permissions.extend([AddUsers, RemoveUsers, EditMdx]);
    }
    permissions
}
