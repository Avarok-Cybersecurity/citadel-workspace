//! # Office Deletion Operations
//!
//! This module provides office deletion functionality with comprehensive
//! cascading cleanup of associated resources including rooms and user memberships.

use crate::handlers::domain::functions::room::room_ops;
use crate::handlers::domain::permission_denied;
use crate::kernel::transaction::Transaction;
use citadel_logging::{error, info};
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office, Permission};

/// Deletes an office and performs comprehensive cleanup.
///
/// This function implements cascading deletion that handles:
/// - Permission validation for DeleteOffice permission
/// - Deletion of all associated rooms within the office
/// - Removal of office from parent workspace's office list
/// - Removal of all user domain memberships for the office
/// - Complete office domain removal from the system
///
/// # Arguments
/// * `tx` - Mutable transaction for database operations
/// * `user_id` - ID of the user performing the deletion (must have DeleteOffice permission)
/// * `office_id` - ID of the office to delete
///
/// # Returns
/// * `Ok(Office)` - Successfully deleted office entity
/// * `Err(NetworkError)` - Permission denied or deletion failure
///
/// # Permission Requirements
/// - User must have `Permission::DeleteOffice` on the target office
/// - Office must exist and be accessible
///
/// # Cascading Operations
/// 1. Delete all rooms associated with the office
/// 2. Remove office from parent workspace's office list
/// 3. Remove all user memberships from the office domain
/// 4. Delete the office domain itself
#[allow(dead_code)]
pub(crate) fn delete_office_inner(
    tx: &mut dyn Transaction,
    user_id: &str, // User performing the deletion
    office_id: &str,
) -> Result<Office, NetworkError> {
    let user = tx
        .get_user(user_id)
        .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
    if !user.has_permission(office_id, Permission::DeleteOffice) {
        return Err(permission_denied(format!(
            "User {} cannot delete office {}",
            user_id, office_id
        )));
    }

    let office_domain_clone = tx
        .get_domain(office_id)
        .ok_or_else(|| {
            NetworkError::msg(format!(
                "Office domain {} not found for deletion",
                office_id
            ))
        })?
        .clone();

    // Extract parent_workspace_id and associated room_ids from the office domain
    let (parent_workspace_id_opt, room_ids_clone) = match &office_domain_clone {
        Domain::Office { office } => (Some(office.workspace_id.clone()), office.rooms.clone()),
        _ => {
            return Err(NetworkError::msg(format!(
                "Domain {} is not an office, cannot be deleted as such",
                office_id
            )))
        }
    };

    // 1. Delete all rooms associated with this office
    for room_id_to_delete in &room_ids_clone {
        info!(
            user_id,
            office_id,
            room_id = room_id_to_delete,
            "Attempting to delete room as part of office deletion"
        );
        match room_ops::delete_room_inner(tx, user_id, room_id_to_delete) {
            Ok(deleted_room) => info!(
                room_id = deleted_room.id,
                "Successfully deleted room during office deletion"
            ),
            Err(e) => {
                error!(room_id = room_id_to_delete, error = ?e, "Failed to delete room during office deletion. Manual cleanup may be required.");
            }
        }
    }

    // 2. Remove office from parent workspace's list
    // Ensure parent_workspace_id is not empty before proceeding
    if let Some(ref parent_ws_id_str) = parent_workspace_id_opt {
        // Corrected: use ref to get &String
        if !parent_ws_id_str.is_empty() {
            let mut workspace_owned_domain = tx
                .get_domain(parent_ws_id_str)
                .ok_or_else(|| {
                    NetworkError::msg(format!(
                        "Parent workspace {} not found for office {}",
                        parent_ws_id_str, office_id
                    ))
                })?
                .clone();

            match &mut workspace_owned_domain {
                Domain::Workspace { workspace, .. } => {
                    workspace.offices.retain(|id| id != office_id);
                }
                _ => {
                    error!(
                        "Parent domain {} for office {} is not a Workspace",
                        parent_ws_id_str, office_id
                    );
                    // Log error and continue with office deletion
                }
            }
            if let Err(e) = tx.update_domain(parent_ws_id_str, workspace_owned_domain) {
                error!(error = ?e, parent_workspace_id = parent_ws_id_str, office_id, "Failed to update parent workspace while deleting office. Manual cleanup may be required.");
            }
        }
    }

    // 3. Remove all users from this office's domain entries
    let users_in_office_ids: Vec<String> = tx
        .get_all_users()
        .values()
        .filter(|u| tx.is_member_of_domain(&u.id, office_id).unwrap_or(false))
        .map(|u| u.id.clone())
        .collect();

    for member_id in users_in_office_ids {
        if let Err(e) = tx.remove_user_from_domain(&member_id, office_id) {
            error!(error = ?e, member_id, office_id, "Failed to remove user from office during office deletion. Manual cleanup may be required.");
        }
    }

    // 4. Actually remove the office domain
    let removed_domain = tx.remove_domain(office_id)?.ok_or_else(|| {
        NetworkError::msg(format!(
            "Office {} domain could not be removed, or was already removed.",
            office_id
        ))
    })?;

    let removed_office = match removed_domain {
        Domain::Office { office, .. } => office,
        _ => {
            return Err(NetworkError::msg(format!(
                "Removed domain {} was not an office as expected.",
                office_id
            )))
        }
    };

    info!(
        user_id = user_id,
        office_id = office_id,
        "Deleted office {:?}",
        removed_office.name
    );
    Ok(removed_office)
}
