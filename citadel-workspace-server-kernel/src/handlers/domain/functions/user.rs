use crate::handlers::domain::permission_denied;
use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, UserRole};
use log::{error, info};
use serde::{Deserialize, Serialize};

// Helper to determine the required permission for managing members of a domain
fn get_required_permission_for_membership_management(domain: &Domain) -> Permission {
    match domain {
        // @human-review: Using Permission::All for Workspace member management due to missing ManageWorkspaceMembers variant. This grants broad permissions and should be reviewed.
        Domain::Workspace { .. } => citadel_workspace_types::structs::Permission::All,
        Domain::Office { .. } => Permission::ManageOfficeMembers,
        Domain::Room { .. } => Permission::ManageRoomMembers,
    }
}

// Define UserWithRole struct locally
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct UserWithRole {
    pub id: String,
    pub name: String,
    pub role_name: String,
}

// Add a user to a domain with a specific role
pub(crate) fn add_user_to_domain_inner(
    tx: &mut dyn Transaction,
    admin_id: &str,       // User performing the action
    user_to_add_id: &str, // User to be added
    domain_id: &str,
    role: UserRole, // Role to assign
) -> Result<(), NetworkError> {
    let admin_user = tx
        .get_user(admin_id)
        .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
    let domain = tx
        .get_domain(domain_id)
        .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

    let required_permission = get_required_permission_for_membership_management(&domain);

    if !admin_user.has_permission(domain_id, required_permission) {
        return Err(permission_denied(format!(
            "Admin user {} lacks permission {:?} for domain {}",
            admin_id, required_permission, domain_id
        )));
    }

    let mut user_to_add = tx
        .get_user(user_to_add_id)
        .ok_or_else(|| NetworkError::msg(format!("User to add {} not found", user_to_add_id)))?
        .clone();

    // Set the user's role for this specific domain.
    // Note: User.role is a global role. Domain-specific roles are managed by permissions.
    // Here, we are effectively granting permissions based on the intended role.
    user_to_add.role = role.clone(); // This might be an oversimplification if User.role is meant to be global.
                                     // For now, let's assume we're setting a 'contextual' role for this domain.
    user_to_add.set_role_permissions(domain_id); // This grants permissions based on user_to_add.role

    // Add user to the domain's member list if not already present
    let mut domain_clone = domain.clone();
    let members_list = match &mut domain_clone {
        Domain::Workspace { workspace } => &mut workspace.members,
        Domain::Office { office } => &mut office.members,
        Domain::Room { room } => &mut room.members,
    };
    if !members_list.contains(&user_to_add_id.to_string()) {
        members_list.push(user_to_add_id.to_string());
    }

    tx.update_user(user_to_add_id, user_to_add)?;
    tx.update_domain(domain_id, domain_clone)?;

    info!(
        target: "citadel",
        "User {user_id} added to domain {domain_id} with role {role}",
        user_id = admin_id,
        domain_id = domain_id,
        role = role,
    );
    Ok(())
}

// Remove a user from a domain
pub(crate) fn remove_user_from_domain_inner(
    tx: &mut dyn Transaction,
    admin_id: &str,          // User performing the action
    user_to_remove_id: &str, // User to be removed
    domain_id: &str,
) -> Result<(), NetworkError> {
    let admin_user = tx
        .get_user(admin_id)
        .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
    let domain = tx
        .get_domain(domain_id)
        .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

    let required_permission = get_required_permission_for_membership_management(&domain);

    if !admin_user.has_permission(domain_id, required_permission) {
        return Err(permission_denied(format!(
            "Admin user {} lacks permission {:?} for domain {}",
            admin_id, required_permission, domain_id
        )));
    }

    let mut user_to_remove = tx
        .get_user(user_to_remove_id)
        .ok_or_else(|| {
            NetworkError::msg(format!("User to remove {} not found", user_to_remove_id))
        })?
        .clone();

    user_to_remove.clear_permissions(domain_id);

    let mut domain_clone = domain.clone();
    let members_list = match &mut domain_clone {
        Domain::Workspace { workspace } => &mut workspace.members,
        Domain::Office { office } => &mut office.members,
        Domain::Room { room } => &mut room.members,
    };
    members_list.retain(|id| id != user_to_remove_id);

    tx.update_user(user_to_remove_id, user_to_remove)?;
    tx.update_domain(domain_id, domain_clone)?;

    info!(
        target: "citadel",
        "Removed user {user_id} from domain {domain_id}",
        user_id = user_to_remove_id,
        domain_id = domain_id
    );

    Ok(())
}

// List all users in a domain
pub(crate) fn list_domain_members_inner(
    tx: &dyn Transaction,
    caller_id: &str,
    domain_id: &str,
) -> Result<Vec<UserWithRole>, NetworkError> {
    let caller_user = tx
        .get_user(caller_id)
        .ok_or_else(|| NetworkError::msg(format!("Caller user {} not found", caller_id)))?;
    let domain = tx
        .get_domain(domain_id)
        .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

    // To list members, user needs the 'manage' permission for that domain type
    let required_permission = get_required_permission_for_membership_management(&domain);

    if !caller_user.has_permission(domain_id, required_permission.clone()) {
        return Err(permission_denied(format!(
            "User {} lacks permission {:?} for domain {}",
            caller_id, required_permission, domain_id
        )));
    }

    let member_ids = domain.members().clone();
    let mut users_with_roles = Vec::new();

    for member_id_ref in &member_ids {
        let member_id_str: &str = member_id_ref;
        match tx.get_user(member_id_str) {
            Some(member_user) => {
                // Use the user's global role, as domain-specific roles aren't in User.permissions HashMap value
                let role = member_user.role.clone();
                users_with_roles.push(UserWithRole {
                    id: member_user.id.clone(),
                    name: member_user.name.clone(),
                    role_name: role.to_string(),
                });
            }
            None => {
                error!(
                    target: "citadel",
                    "User ID {user_id} found in domain members list but user object not found in domain {domain_id}.",
                    user_id = member_id_str,
                    domain_id = domain_id,
                );
            }
        }
    }

    info!(
        target: "citadel",
        "Listed domain members for domain {domain_id}. Caller: {caller_id}. Count: {count}",
        caller_id = caller_id,
        domain_id = domain_id,
        count = users_with_roles.len()
    );
    Ok(users_with_roles)
}
