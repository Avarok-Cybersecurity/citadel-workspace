use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::NetworkError;
use crate::WORKSPACE_ROOT_ID;
use crate::kernel::transaction::rbac::DomainType;
use citadel_workspace_types::{
    structs::{Domain, Permission, UserRole},
};
use log::{debug, info, warn};
use std::collections::HashSet;

// Helper function to get domain type from Domain
fn get_domain_type_from_domain_entry(domain_entry: &Domain) -> Result<DomainType, NetworkError> {
    match domain_entry {
        Domain::Workspace { .. } => Ok(DomainType::Workspace),
        Domain::Office { .. } => Ok(DomainType::Office),
        Domain::Room { .. } => Ok(DomainType::Room),
    }
}

// Helper function to get mutable members from domain
fn get_mutable_members_from_domain_entry(domain_entry: &mut Domain) -> Result<&mut Vec<String>, NetworkError> {
    match domain_entry {
        Domain::Workspace { workspace, .. } => Ok(&mut workspace.members),
        Domain::Office { office, .. } => Ok(&mut office.members),
        Domain::Room { room, .. } => Ok(&mut room.members),
    }
}

// Helper function to get members from domain
fn get_members_from_domain_entry(domain_entry: &Domain) -> Result<&Vec<String>, NetworkError> {
    match domain_entry {
        Domain::Workspace { workspace, .. } => Ok(&workspace.members),
        Domain::Office { office, .. } => Ok(&office.members),
        Domain::Room { room, .. } => Ok(&room.members),
    }
}

// Helper function to determine the parent domain ID for permission checking
fn get_permission_check_domain_id(tx: &dyn Transaction, domain_id: &str) -> Result<String, NetworkError> {
    let domain_entry = tx.get_domain(domain_id).ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;
    match domain_entry { 
        Domain::Room { room, .. } => { 
            let parent = room.office_id.clone();
            if parent.is_empty() {
                return Err(NetworkError::msg("Room has no parent office ID or parent_id is empty"));
            }
            Ok(parent)
        }
        Domain::Office { .. } => Ok(WORKSPACE_ROOT_ID.to_string()), 
        Domain::Workspace { .. } => Ok(WORKSPACE_ROOT_ID.to_string()), 
    }
}

// Helper function to get domain type from domain_id using Transaction
fn get_domain_type_from_id(tx: &dyn Transaction, domain_id: &str) -> Result<DomainType, NetworkError> {
    let domain_entry = tx.get_domain(domain_id).ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;
    get_domain_type_from_domain_entry(domain_entry)
}

// Helper function to retrieve role permissions based on domain type
fn get_role_based_permissions(role: &UserRole, domain_type: DomainType) -> HashSet<Permission> {
    let mut permissions = HashSet::new();
    match role {
        UserRole::Admin => {
            permissions.insert(Permission::All);
        }
        UserRole::Owner => {
            match domain_type {
                DomainType::Workspace => {
                    permissions.insert(Permission::EditWorkspaceConfig);
                }
                DomainType::Office => {
                    permissions.insert(Permission::UpdateOfficeSettings);
                }
                DomainType::Room => {
                    permissions.insert(Permission::UpdateRoomSettings);
                }
            }
        }
        UserRole::Member => match domain_type {
            DomainType::Workspace | DomainType::Office | DomainType::Room => {
                permissions.insert(Permission::ViewContent);
            }
        },
        UserRole::Guest => match domain_type {
            DomainType::Workspace | DomainType::Office | DomainType::Room => {
                permissions.insert(Permission::ViewContent);
            }
        },
        UserRole::Banned => {
            // No permissions for banned users
        }
        UserRole::Custom { name: _, rank: _ } => {
            // Implement custom role permission logic here if needed
            // For now, let's assume custom roles might have ViewContent by default
            permissions.insert(Permission::ViewContent);
        }
    }
    permissions
}

// Add a user to a domain with a specific role
pub(crate) fn add_user_to_domain_inner(
    tx: &mut dyn Transaction,
    actor_user_id: &str,
    target_user_id: &str,
    domain_id: &str,
    role: UserRole,
) -> Result<(), NetworkError> {
    debug!(
        "Attempting to add user {} to domain {} with role {:?} by actor {}",
        target_user_id,
        domain_id,
        role,
        actor_user_id
    );

    // Get the actor user for permission checks (immutable borrow of tx.users)
    let actor_user = tx.get_user(actor_user_id).ok_or_else(|| {
        NetworkError::msg(format!("Actor user {} not found", actor_user_id))
    })?;

    // Determine the domain_id to check for permissions (immutable borrows of tx.domains)
    let id_to_check_permissions_on = get_permission_check_domain_id(tx, domain_id)?;
    debug!("Permission check for add_user_to_domain_inner will be on domain: {}", id_to_check_permissions_on);

    // Check if actor has permission to add users to this domain or its parent
    // Using AddUsers permission as it's more generic for adding members
    if !actor_user.has_permission(&id_to_check_permissions_on, Permission::AddUsers) {
        return Err(NetworkError::msg(format!(
            "Actor {} does not have AddUsers permission on domain {} to add user {} to domain {}",
            actor_user_id,
            id_to_check_permissions_on,
            target_user_id,
            domain_id
        )));
    }

    // Get the domain type for role-based permissions (immutable borrow of tx.domains)
    let domain_type_for_role_perms = get_domain_type_from_id(tx, domain_id)?;
    let role_permissions = get_role_based_permissions(&role, domain_type_for_role_perms);

    // Get mutable reference to the user to add (mutable borrow of tx.users)
    // This must happen after all immutable borrows of tx related to actor_user and domain type checks are done if they conflict.
    // However, tx.users and tx.domains are distinct fields, so this order should be fine.
    let user_to_add = tx.get_user_mut(target_user_id).ok_or_else(|| {
        NetworkError::msg(format!("User to add {} not found", target_user_id))
    })?;

    user_to_add.role = role.clone(); // Set the user's role for this context
    user_to_add.permissions.insert(domain_id.to_string(), role_permissions);
    info!(
        "Successfully set role {:?} and permissions for user {} in domain {}",
        role,
        target_user_id,
        domain_id
    );

    // Add user to domain's member list (mutable borrow of tx.domains)
    let domain_entry = tx.get_domain_mut(domain_id).ok_or_else(|| {
        NetworkError::msg(format!("Domain {} not found when adding user", domain_id))
    })?;
    let members = get_mutable_members_from_domain_entry(domain_entry)?;
    if !members.contains(&target_user_id.to_string()) {
        members.push(target_user_id.to_string());
        info!("User {} added to domain {} member list", target_user_id, domain_id);
    } else {
        info!("User {} already in domain {} member list", target_user_id, domain_id);
    }

    Ok(())
}

pub(crate) fn remove_user_from_domain_inner(
    tx: &mut dyn Transaction,
    actor_user_id: &str,
    target_user_id: &str,
    domain_id: &str,
) -> Result<(), NetworkError> {
    debug!(
        "Attempting to remove user {} from domain {} by actor {}",
        target_user_id,
        domain_id,
        actor_user_id
    );

    let actor_user = tx.get_user(actor_user_id).ok_or_else(|| {
        NetworkError::msg(format!("Actor user {} not found", actor_user_id))
    })?;

    let id_to_check_permissions_on = get_permission_check_domain_id(tx, domain_id)?;
    debug!("Permission check for remove_user_from_domain_inner will be on domain: {}", id_to_check_permissions_on);

    // Using RemoveUsers permission
    if !actor_user.has_permission(&id_to_check_permissions_on, Permission::RemoveUsers) {
        return Err(NetworkError::msg(format!(
            "Actor {} does not have RemoveUsers permission on domain {} to remove user {} from domain {}",
            actor_user_id,
            id_to_check_permissions_on,
            target_user_id,
            domain_id
        )));
    }

    // Check if user is in domain before attempting to remove (read operation)
    let domain_entry_for_read = tx.get_domain(domain_id).ok_or_else(|| {
        NetworkError::msg(format!("Domain {} not found when checking members for removal", domain_id))
    })?;
    let members_for_check = get_members_from_domain_entry(domain_entry_for_read)?;

    let is_member = members_for_check.contains(&target_user_id.to_string()); // E0502 fix: check before mutable borrow of tx.users

    if !is_member {
        warn!("User {} not found in domain {} member list, cannot remove from list. Still clearing permissions.", target_user_id, domain_id);
    }

    // Now get user mutably to clear permissions
    let user_being_removed = tx.get_user_mut(target_user_id).ok_or_else(|| {
        NetworkError::msg(format!("User to remove {} not found", target_user_id))
    })?;
    user_being_removed.permissions.remove(domain_id);
    info!("Permissions for user {} in domain {} cleared", target_user_id, domain_id);

    // Now get domain mutably to update members list if user was in it
    if is_member { // E0502 fix: use the pre-calculated is_member
        let domain_entry_for_write = tx.get_domain_mut(domain_id).ok_or_else(|| {
            NetworkError::msg(format!("Domain {} not found when removing user from member list (for write)", domain_id))
        })?;
        let members_for_write = get_mutable_members_from_domain_entry(domain_entry_for_write)?;
        members_for_write.retain(|id| id != target_user_id);
        info!("User {} removed from domain {} member list", target_user_id, domain_id);
    }

    Ok(())
}
