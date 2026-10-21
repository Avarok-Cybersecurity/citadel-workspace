//! A role table as it is stored, and reading one stored before it named new members' role.
//!
//! The stored form is the wire form without the Owner, which is never written. One field may be
//! missing: `default_role_id`, which tables stored before it existed do not carry. Such a table
//! is read with the legacy-load rule, `legacy_default_role`, and nothing else is filled in.
//!
//! A table also records which upgrades it has had (`version`). One stored before an upgrade is
//! given it when read, and written with the current version by the next edit, so an upgrade
//! happens once and whatever an administrator does after it stands.

use crate::roles::{seed_roles, RoleDefinition, WorkspaceRoles, GUEST_ROLE_ID, MEMBER_ROLE_ID};
use crate::structs::Permission;
use serde::{Deserialize, Serialize};

/// The upgrades a stored table has had:
/// - 1: `ShareSecureLinks` for every role that can view the workspace, except the Guest.
/// - 2: `AppInstall` for every role that can view the workspace, except the Guest.
pub const ROLE_TABLE_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredRoles {
    pub roles: Vec<RoleDefinition>,
    /// None in a table stored before new members' role was part of it.
    #[serde(default)]
    pub default_role_id: Option<String>,
    /// The upgrades this table has had. 0 in a table stored before upgrades were recorded,
    /// which has had none.
    #[serde(default)]
    pub version: u32,
}

/// Bring a table stored at `version` up to `ROLE_TABLE_VERSION`.
///
/// 1: a role that could view the workspace before secure links existed would have been given
/// `ShareSecureLinks` had it been made after, as the Member seed is. Without it, such a role also
/// could not assign Member, which now carries it. The Guest is read-only and stays so; the Owner
/// is not stored and holds everything already.
///
/// 2: the same for `AppInstall` (installing an app for oneself), which the Member seed carries
/// since apps existed. Nothing an app could be granted comes with it: every `AppInstallAllow*`,
/// and installing for anyone else, stays an administrator's decision.
fn upgrade(roles: &mut [RoleDefinition], version: u32) {
    for (since, permission) in [
        (1, Permission::ShareSecureLinks),
        (2, Permission::AppInstall),
    ] {
        if version < since {
            give_every_viewer(roles, permission);
        }
    }
}

/// `permission` for every stored role that can view the workspace, bar the Guest.
fn give_every_viewer(roles: &mut [RoleDefinition], permission: Permission) {
    for role in roles.iter_mut() {
        if !role.is_owner()
            && role.id != GUEST_ROLE_ID
            && role.grants(Permission::ViewContent)
            && !role.grants(permission)
        {
            role.permissions.insert(permission);
        }
    }
}

/// How the stored table's default was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultRoleRead {
    /// Stored, and naming a role the table has.
    Stored,
    /// Not stored (a table older than the field): chosen by `legacy_default_role`.
    Legacy,
    /// Stored, but naming no role a member can hold. No edit writes that; chosen by
    /// `legacy_default_role` all the same, and worth a warning.
    Dangling { named: String },
}

/// The legacy-load rule: Member when the table still has it, otherwise the lowest role below
/// the Owner, the one with the least reach. `None` for a table with no role but the Owner.
pub fn legacy_default_role(table: &WorkspaceRoles) -> Option<&RoleDefinition> {
    table.get(MEMBER_ROLE_ID).or_else(|| {
        table
            .roles
            .iter()
            .filter(|role| !role.is_owner())
            .min_by_key(|role| role.position)
    })
}

impl StoredRoles {
    /// What is written for `table`.
    pub fn of(table: &WorkspaceRoles) -> Self {
        Self {
            roles: table.editable(),
            default_role_id: Some(table.default_role_id.clone()),
            version: ROLE_TABLE_VERSION,
        }
    }

    /// The table this record holds, Owner first, with a default every member can be given.
    ///
    /// A table with no role but the Owner (an Owner deleting every other role, before the
    /// default had to survive deletion) gets the seeded Member back as its default: new members
    /// must be given some role, and the Owner is never that role.
    pub fn into_table(self) -> (WorkspaceRoles, DefaultRoleRead) {
        let stored_default = self.default_role_id;
        let mut roles = self.roles;
        upgrade(&mut roles, self.version);
        let mut table = WorkspaceRoles {
            roles,
            default_role_id: stored_default.clone().unwrap_or_default(),
        }
        .normalized();
        if table.default_role().is_some() {
            return (table, DefaultRoleRead::Stored);
        }
        let read = match stored_default {
            None => DefaultRoleRead::Legacy,
            Some(named) => DefaultRoleRead::Dangling { named },
        };
        let chosen = match legacy_default_role(&table) {
            Some(role) => role.id.clone(),
            None => {
                table
                    .roles
                    .extend(seed_roles().into_iter().filter(|r| r.id == MEMBER_ROLE_ID));
                table = table.normalized();
                MEMBER_ROLE_ID.to_string()
            }
        };
        table.default_role_id = chosen;
        (table, read)
    }
}
