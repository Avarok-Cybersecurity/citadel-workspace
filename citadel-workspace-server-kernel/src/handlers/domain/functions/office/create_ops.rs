//! # Office Creation Operations
//!
//! This module provides office creation functionality within workspaces.
//! It handles the complete lifecycle of office entity creation including
//! permission validation, entity creation, and workspace integration.

use crate::handlers::domain::permission_denied;
use crate::kernel::transaction::Transaction;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office, Permission, UserRole};

/// Creates a new office within a specified workspace.
///
/// This function performs comprehensive office creation including:
/// - User permission validation for CreateOffice permission on parent workspace
/// - Parent workspace existence and type validation  
/// - Office entity creation with proper initialization
/// - Domain registration and user role assignment
/// - Workspace office list update
///
/// # Arguments
/// * `tx` - Mutable transaction for database operations
/// * `user_id` - ID of the user creating the office (must have CreateOffice permission)
/// * `workspace_id` - ID of the parent workspace where office will be created
/// * `office_id` - Pre-generated unique ID for the new office
/// * `name` - Display name for the office
/// * `description` - Detailed description of the office purpose
/// * `mdx_content` - Optional MDX content for rich office documentation
///
/// # Returns
/// * `Ok(Office)` - Successfully created office entity
/// * `Err(NetworkError)` - Permission denied, invalid workspace, or creation failure
///
/// # Permission Requirements
/// - User must have `Permission::CreateOffice` on the parent workspace
/// - User must exist in the system
/// - Parent workspace must exist and be of type Workspace
#[allow(dead_code)]
pub(crate) fn create_office_inner(
    tx: &mut dyn Transaction,
    user_id: &str,      // User creating the office
    workspace_id: &str, // Workspace this office belongs to
    office_id: &str,    // Pre-generated office ID
    name: &str,
    description: &str,
    mdx_content: Option<String>, // Added mdx_content parameter
) -> Result<Office, NetworkError> {
    eprintln!(
        // <<< NEW LOG INSERTED HERE
        "[CREATE_OFFICE_INNER_ENTRY_EPRINTLN] Received workspace_id: {}, office_id: {}, name: {}",
        workspace_id, office_id, name
    );
    // Changed return type
    let user = tx
        .get_user(user_id)
        .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

    debug!(
        user_id = user_id,
        workspace_id = workspace_id,
        user_details = ?user,
        "Checking CreateOffice permission for user on workspace"
    );

    let has_perm = user.has_permission(workspace_id, Permission::CreateOffice); // Use the potentially overridden value
    debug!(
        user_id = user_id,
        workspace_id = workspace_id,
        permission_check_result = has_perm,
        "Result of user.has_permission(workspace_id, Permission::CreateOffice)"
    );

    // Permission check: User needs CreateOffice permission on the parent workspace
    if !has_perm {
        return Err(permission_denied(format!(
            "User {} cannot create office in workspace {}",
            user_id, workspace_id
        )));
    }

    // Ensure parent workspace exists and is a workspace
    let mut workspace_owned_domain = tx
        .get_domain(workspace_id)
        .ok_or_else(|| {
            NetworkError::msg(format!(
                "Parent workspace domain {} not found",
                workspace_id
            ))
        })?
        .clone();

    let workspace_obj = workspace_owned_domain.as_workspace_mut().ok_or_else(|| {
        NetworkError::msg(format!("Parent domain {} is not a workspace", workspace_id))
    })?;

    // Create the new office struct
    let new_office = Office {
        id: office_id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        owner_id: user_id.to_string(),
        members: vec![user_id.to_string()], // Creator is the first member
        // denylist: Vec::new(), // Commented out
        rooms: Vec::new(),
        mdx_content: mdx_content.unwrap_or_default(), // Use provided mdx_content
        metadata: Vec::new(),
    };

    // Create the domain entry for the office
    let office_domain = Domain::Office {
        office: new_office.clone(), // new_office is still type Office here
    };
    tx.insert_domain(office_id.to_string(), office_domain)?;

    // Add user to the new office's domain with Owner role
    tx.add_user_to_domain(user_id, office_id, UserRole::Owner)?;

    // Add office_id to workspace's list of offices
    let office_id_string = office_id.to_string();
    if !workspace_obj.offices.contains(&office_id_string) {
        workspace_obj.offices.push(office_id_string);
    }
    tx.update_domain(workspace_id, workspace_owned_domain)?;

    info!(
        user_id = user_id,
        office_id = office_id,
        workspace_id = workspace_id,
        "Created office {:?} in workspace {}",
        new_office.name,
        workspace_id
    );
    Ok(new_office)
}
