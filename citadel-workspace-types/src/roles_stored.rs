//! A role table as it is stored, and reading one stored before it named new members' role.
//!
//! The stored form is the wire form without the Owner, which is never written. One field may be
//! missing: `default_role_id`, which tables stored before it existed do not carry. Such a table
//! is read with the legacy-load rule, `legacy_default_role`, and nothing else is filled in.

use crate::roles::{seed_roles, RoleDefinition, WorkspaceRoles, MEMBER_ROLE_ID};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredRoles {
    pub roles: Vec<RoleDefinition>,
    /// None in a table stored before new members' role was part of it.
    #[serde(default)]
    pub default_role_id: Option<String>,
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
        }
    }

    /// The table this record holds, Owner first, with a default every member can be given.
    ///
    /// A table with no role but the Owner (an Owner deleting every other role, before the
    /// default had to survive deletion) gets the seeded Member back as its default: new members
    /// must be given some role, and the Owner is never that role.
    pub fn into_table(self) -> (WorkspaceRoles, DefaultRoleRead) {
        let stored_default = self.default_role_id;
        let mut table = WorkspaceRoles {
            roles: self.roles,
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
