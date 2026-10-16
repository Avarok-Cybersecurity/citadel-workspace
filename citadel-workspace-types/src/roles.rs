//! A workspace's roles: the table its administrators edit, and the built-ins it starts from.
//!
//! A role is a named, positioned bundle of permissions. Every member of a workspace holds one
//! (`User::workspace_roles`), and holds its permissions throughout that workspace; per-node
//! grants sit on top, as before.
//!
//! Position is the chain of command. Higher outranks lower, and nobody but the Owner may assign,
//! edit or act on a role at or above their own. The Owner role is fixed: it is not stored, so no
//! edit and no corrupted record can change it, and `WorkspaceRoles::normalized` puts it back at
//! the top of every table read.
//!
//! Pure. Storage and the rules that need the members live in the kernel.

use crate::structs::Permission;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

pub const OWNER_ROLE_ID: &str = "owner";
pub const ADMIN_ROLE_ID: &str = "admin";
pub const MEMBER_ROLE_ID: &str = "member";
pub const GUEST_ROLE_ID: &str = "guest";

/// The Owner's position. No other role may hold it, so the Owner is above every role there is.
pub const OWNER_POSITION: u16 = u16::MAX;

/// Longest role name, in characters.
pub const MAX_ROLE_NAME_CHARS: usize = 48;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoleDefinition {
    pub id: String,
    pub name: String,
    pub permissions: HashSet<Permission>,
    /// Higher outranks lower. Unique within a table.
    pub position: u16,
    /// `#rrggbb`, or none for the default badge colour.
    pub color: Option<String>,
}

impl RoleDefinition {
    pub fn is_owner(&self) -> bool {
        self.id == OWNER_ROLE_ID
    }

    /// Whether this role confers `permission`, honouring the `All` wildcard.
    pub fn grants(&self, permission: Permission) -> bool {
        Permission::has_permission(&self.permissions, &permission)
    }
}

/// A workspace's role table, highest position first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkspaceRoles {
    pub roles: Vec<RoleDefinition>,
}

impl WorkspaceRoles {
    /// The table a workspace has before anyone edits it.
    pub fn seeded() -> Self {
        Self {
            roles: seed_roles(),
        }
        .normalized()
    }

    /// The fixed Owner at the top, whatever was stored, and the rest by position.
    ///
    /// A stored entry claiming the Owner's id or position is dropped rather than trusted: the
    /// Owner is defined here, never by a record.
    pub fn normalized(mut self) -> Self {
        self.roles
            .retain(|role| !role.is_owner() && role.position != OWNER_POSITION);
        self.roles.push(owner_role());
        self.roles
            .sort_by_key(|role| std::cmp::Reverse(role.position));
        self
    }

    pub fn get(&self, role_id: &str) -> Option<&RoleDefinition> {
        self.roles.iter().find(|role| role.id == role_id)
    }

    /// What is stored: every role but the Owner, which is never written.
    pub fn editable(&self) -> Vec<RoleDefinition> {
        self.roles
            .iter()
            .filter(|role| !role.is_owner())
            .cloned()
            .collect()
    }
}

/// Everything but the `All` wildcard and `ConfigureSystem`, which is server-level.
///
/// Derived by subtraction, so a permission added to the enum is the Owner's by default. The
/// explicit list this replaced drifted several times, each time leaving the Owner unable to do
/// something a Member could.
pub fn owner_permissions() -> HashSet<Permission> {
    Permission::ALL_VARIANTS
        .into_iter()
        .filter(|p| !matches!(p, Permission::All | Permission::ConfigureSystem))
        .collect()
}

/// The fixed Owner role.
pub fn owner_role() -> RoleDefinition {
    RoleDefinition {
        id: OWNER_ROLE_ID.to_string(),
        name: "Owner".to_string(),
        permissions: owner_permissions(),
        position: OWNER_POSITION,
        color: None,
    }
}

fn seed(id: &str, name: &str, position: u16, permissions: &[Permission]) -> RoleDefinition {
    RoleDefinition {
        id: id.to_string(),
        name: name.to_string(),
        permissions: permissions.iter().copied().collect(),
        position,
        color: None,
    }
}

/// The built-in roles, and the only definition of what each holds before it is edited.
///
/// The sets are the fixed ones every workspace had before roles could be edited, so an upgraded
/// workspace's members keep exactly the authority they had. `scripts/check-permission-parity.mjs`
/// reads `bindings/seed_roles.json`, which a test keeps equal to this.
pub fn seed_roles() -> Vec<RoleDefinition> {
    use Permission::*;
    vec![
        owner_role(),
        // The `All` wildcard, as before: Admin may do everything, ConfigureSystem included.
        seed(ADMIN_ROLE_ID, "Admin", 300, &[All]),
        // No EditContent: editing takes Owner or Admin.
        seed(
            MEMBER_ROLE_ID,
            "Member",
            200,
            &[
                ViewContent,
                ViewMembers,
                SendMessages,
                ReadMessages,
                UploadFiles,
                DownloadFiles,
            ],
        ),
        // Read-only.
        seed(GUEST_ROLE_ID, "Guest", 100, &[ViewContent, ViewMembers]),
    ]
}

/// The first of `granting` that `held` does not confer, honouring `All` on both sides: a holder
/// of `All` confers anything, and granting `All` takes holding it.
pub fn first_missing<'a>(
    held: &HashSet<Permission>,
    granting: impl IntoIterator<Item = &'a Permission>,
) -> Option<Permission> {
    granting
        .into_iter()
        .find(|p| !Permission::has_permission(held, p))
        .copied()
}

/// Whether `color` is a `#rrggbb` colour. Anything else is refused, since the UI puts it in a
/// style attribute.
pub fn is_valid_role_color(color: &str) -> bool {
    let bytes = color.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

/// A role name as it will be stored, or why it cannot be.
pub fn clean_role_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A role needs a name".to_string());
    }
    if name.chars().count() > MAX_ROLE_NAME_CHARS {
        return Err(format!(
            "A role name may be at most {MAX_ROLE_NAME_CHARS} characters"
        ));
    }
    if name.chars().any(char::is_control) {
        return Err("A role name may not contain control characters".to_string());
    }
    Ok(name.to_string())
}
