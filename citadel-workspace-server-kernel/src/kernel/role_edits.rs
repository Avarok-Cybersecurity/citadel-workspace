//! Edits to a workspace's role table, and the rules they obey.
//!
//! Pure: each takes the table and the actor's role and returns the new table or why not. The
//! handler (`command_processor/roles.rs`) reads, locks, writes and announces.
//!
//! The rules are the ladder's (`role_authority`): an actor edits only roles positioned below
//! their own, places roles only below their own, and grants only what their own role confers.
//! The Owner is above the ladder, and its own role is fixed. Positions are unique, so the ladder
//! is a total order.

use citadel_workspace_types::roles::{
    clean_role_name, first_missing, is_valid_role_color, RoleDefinition, WorkspaceRoles,
    OWNER_POSITION,
};
use citadel_workspace_types::roles_protocol::RoleChange;
use citadel_workspace_types::structs::Permission;
use std::collections::HashSet;

/// Most roles a table may hold, the Owner included.
pub const MAX_ROLES: usize = 64;

/// Whether `actor` may edit, delete or assign a role at `position`.
pub fn outranks(actor: &RoleDefinition, position: u16) -> bool {
    actor.is_owner() || position < actor.position
}

fn check_grant(actor: &RoleDefinition, granting: &[Permission]) -> Result<(), String> {
    match first_missing(&actor.permissions, granting.iter()) {
        None => Ok(()),
        Some(missing) => Err(format!(
            "Permission denied: {} does not hold {missing:?} and cannot grant it",
            actor.name
        )),
    }
}

fn check_position(
    table: &WorkspaceRoles,
    actor: &RoleDefinition,
    position: u16,
    except_id: Option<&str>,
) -> Result<(), String> {
    if position == OWNER_POSITION || !outranks(actor, position) {
        return Err(format!(
            "Permission denied: a role may only be placed below {}",
            actor.name
        ));
    }
    if let Some(other) = table
        .roles
        .iter()
        .find(|role| role.position == position && Some(role.id.as_str()) != except_id)
    {
        return Err(format!("{} already holds that position", other.name));
    }
    Ok(())
}

fn check_name(
    table: &WorkspaceRoles,
    name: &str,
    except_id: Option<&str>,
) -> Result<String, String> {
    let name = clean_role_name(name)?;
    if table.roles.iter().any(|role| {
        Some(role.id.as_str()) != except_id && role.name.to_lowercase() == name.to_lowercase()
    }) {
        return Err(format!("A role named '{name}' already exists"));
    }
    Ok(name)
}

fn check_color(color: &Option<String>) -> Result<(), String> {
    match color {
        Some(color) if !is_valid_role_color(color) => {
            Err(format!("'{color}' is not a #rrggbb colour"))
        }
        _ => Ok(()),
    }
}

/// Refuse handing `role` to anyone the actor did not choose by name: holders of a deleted role,
/// or every new member. Below the actor, and carrying nothing they lack.
fn check_assignable(actor: &RoleDefinition, role: &RoleDefinition) -> Result<(), String> {
    if !outranks(actor, role.position) {
        return Err(format!(
            "Permission denied: {} cannot assign {}",
            actor.name, role.name
        ));
    }
    if actor.is_owner() {
        return Ok(());
    }
    let carried: Vec<Permission> = role.permissions.iter().copied().collect();
    check_grant(actor, &carried)
}

/// The role `id`, if the actor may change it.
fn editable<'a>(
    table: &'a WorkspaceRoles,
    actor: &RoleDefinition,
    id: &str,
) -> Result<&'a RoleDefinition, String> {
    let role = table
        .get(id)
        .ok_or_else(|| format!("No role '{id}' exists in this workspace"))?;
    if role.is_owner() {
        return Err("The Owner role cannot be changed or deleted".to_string());
    }
    if !outranks(actor, role.position) {
        return Err(format!(
            "Permission denied: {} is not below {}",
            role.name, actor.name
        ));
    }
    Ok(role)
}

/// Add a role. `id` is chosen by the caller, which generates it.
pub fn create(
    table: &WorkspaceRoles,
    actor: &RoleDefinition,
    id: String,
    name: &str,
    permissions: &[Permission],
    position: u16,
    color: Option<String>,
) -> Result<WorkspaceRoles, String> {
    if table.roles.len() >= MAX_ROLES {
        return Err(format!("A workspace may have at most {MAX_ROLES} roles"));
    }
    if table.get(&id).is_some() {
        return Err(format!("A role with id '{id}' already exists"));
    }
    let name = check_name(table, name, None)?;
    check_position(table, actor, position, None)?;
    check_color(&color)?;
    check_grant(actor, permissions)?;

    let mut next = table.clone();
    next.roles.push(RoleDefinition {
        id,
        name,
        permissions: permissions.iter().copied().collect(),
        position,
        color,
    });
    Ok(next.normalized())
}

/// Apply `changes` to role `id`, all or none.
pub fn update(
    table: &WorkspaceRoles,
    actor: &RoleDefinition,
    id: &str,
    changes: &[RoleChange],
) -> Result<WorkspaceRoles, String> {
    let mut role = editable(table, actor, id)?.clone();
    let mut make_default = false;
    for change in changes {
        match change {
            RoleChange::Rename(name) => role.name = check_name(table, name, Some(id))?,
            RoleChange::Recolor(color) => {
                check_color(color)?;
                role.color = color.clone();
            }
            RoleChange::Move(position) => {
                check_position(table, actor, *position, Some(id))?;
                role.position = *position;
            }
            RoleChange::Grant(granting) => {
                check_grant(actor, granting)?;
                role.permissions.extend(granting.iter().copied());
            }
            RoleChange::Revoke(revoking) => revoke(&mut role.permissions, revoking),
            RoleChange::MakeDefault => make_default = true,
        }
    }
    // Checked on the role as edited: every new member will be given it.
    if make_default {
        check_assignable(actor, &role)?;
    }

    let mut next = table.clone();
    next.roles.retain(|existing| existing.id != id);
    next.roles.push(role);
    if make_default {
        next.default_role_id = id.to_string();
    }
    Ok(next.normalized())
}

/// Take `revoking` away. A set holding the `All` wildcard is first spelled out as every
/// permission, so revoking one leaves the rest rather than leaving the wildcard standing.
fn revoke(permissions: &mut HashSet<Permission>, revoking: &[Permission]) {
    if permissions.contains(&Permission::All) && revoking.iter().any(|p| *p != Permission::All) {
        permissions.remove(&Permission::All);
        permissions.extend(
            Permission::ALL_VARIANTS
                .into_iter()
                .filter(|p| *p != Permission::All),
        );
    }
    for permission in revoking {
        permissions.remove(permission);
    }
}

/// Remove role `id`. Its holders move to `reassign_to`, which the actor must be able to assign:
/// below them, and holding nothing they lack. When `id` is the role new members get,
/// `reassign_to` becomes it, in the same table write.
pub fn delete(
    table: &WorkspaceRoles,
    actor: &RoleDefinition,
    id: &str,
    reassign_to: &str,
) -> Result<WorkspaceRoles, String> {
    let deleting = editable(table, actor, id)?;
    if reassign_to == id {
        return Err("A role's holders cannot be moved to the role being deleted".to_string());
    }
    let target = table
        .get(reassign_to)
        .ok_or_else(|| format!("No role '{reassign_to}' exists to move its holders to"))?;
    check_assignable(actor, target)?;
    let is_default = table.default_role_id == id;
    if is_default && target.is_owner() {
        return Err(format!(
            "{} is the role new members get, and the role its holders move to takes its place; \
             new members cannot be given the Owner role",
            deleting.name
        ));
    }

    let mut next = table.clone();
    next.roles.retain(|role| role.id != id);
    if is_default {
        next.default_role_id = reassign_to.to_string();
    }
    Ok(next.normalized())
}
