//! A role table as it is stored.
//!
//! The stored form is the wire form without the Owner, which is never written, plus the format
//! `version`. A table stored by an earlier server (no `default_role_id`, or another version) is
//! refused, not upgraded.

use crate::roles::{seed_roles, RoleDefinition, WorkspaceRoles, MEMBER_ROLE_ID};
use serde::{Deserialize, Serialize};

/// The stored format. A table with any other version was written by another server.
pub const ROLE_TABLE_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredRoles {
    pub roles: Vec<RoleDefinition>,
    pub default_role_id: String,
    pub version: u32,
}

/// How the stored table's default was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultRoleRead {
    /// Stored, and naming a role the table has.
    Stored,
    /// Stored, but naming no role a member can hold. No edit writes that; chosen by
    /// `fallback_default_role` all the same, and worth a warning.
    Dangling { named: String },
}

/// The role a damaged table's new members get: Member when the table still has it, otherwise
/// the lowest role below the Owner, the one with the least reach. `None` for a table with no
/// role but the Owner.
pub fn fallback_default_role(table: &WorkspaceRoles) -> Option<&RoleDefinition> {
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
            default_role_id: table.default_role_id.clone(),
            version: ROLE_TABLE_VERSION,
        }
    }

    /// The table this record holds, Owner first, with a default every member can be given; an
    /// error for a table of another version.
    pub fn into_table(self) -> Result<(WorkspaceRoles, DefaultRoleRead), String> {
        if self.version != ROLE_TABLE_VERSION {
            return Err(format!(
                "a role table of format {} (this server reads {ROLE_TABLE_VERSION}) was written by \
                 another server",
                self.version
            ));
        }
        let mut table = WorkspaceRoles {
            roles: self.roles,
            default_role_id: self.default_role_id.clone(),
        }
        .normalized();
        if table.default_role().is_some() {
            return Ok((table, DefaultRoleRead::Stored));
        }
        let chosen = match fallback_default_role(&table) {
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
        Ok((
            table,
            DefaultRoleRead::Dangling {
                named: self.default_role_id,
            },
        ))
    }
}
