//! # Office Listing Operations
//!
//! This module provides office listing functionality with flexible filtering
//! by workspace membership and user permissions.

use crate::handlers::domain::permission_denied;
use crate::kernel::transaction::Transaction;
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office};

/// Lists offices accessible to a user, optionally filtered by workspace.
///
/// This function provides flexible office listing with two modes:
/// - **Workspace-specific**: Lists offices within a specific workspace (user must be workspace member)
/// - **User-wide**: Lists all offices the user has access to across all workspaces
///
/// # Arguments
/// * `tx` - Read-only transaction for database operations
/// * `user_id` - ID of the user requesting the office list
/// * `workspace_id` - Optional workspace ID to filter offices by specific workspace
///
/// # Returns
/// * `Ok(Vec<Office>)` - List of accessible offices
/// * `Err(NetworkError)` - User not found, permission denied, or query failure
///
/// # Permission Requirements
/// - User must exist in the system
/// - For workspace-specific listing: User must be a member of the specified workspace
/// - For each office: User must be a member of the office domain
///
/// # Behavior
/// - With `workspace_id`: Returns offices in that workspace where user has membership
/// - Without `workspace_id`: Returns all offices across all workspaces where user has membership
#[allow(dead_code)]
pub(crate) fn list_offices_inner(
    tx: &dyn Transaction,
    user_id: &str,
    workspace_id: Option<String>,
) -> Result<Vec<Office>, NetworkError> {
    let user = tx
        .get_user(user_id)
        .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
    let mut offices = Vec::new();

    if let Some(ws_id) = workspace_id {
        if !tx.is_member_of_domain(&user.id, &ws_id)? {
            return Err(permission_denied(format!(
                "User {} is not a member of workspace {}",
                user_id, ws_id
            )));
        }

        let workspace_domain = tx.get_domain(&ws_id).ok_or_else(|| {
            NetworkError::msg(format!("Workspace domain {} not found", ws_id))
        })?;

        let workspace = workspace_domain
            .as_workspace()
            .ok_or_else(|| NetworkError::msg(format!("Domain {} is not a workspace", ws_id)))?;

        for off_id in &workspace.offices {
            if tx.is_member_of_domain(&user.id, off_id).unwrap_or(false) {
                if let Some(Domain::Office { office, .. }) = tx.get_domain(off_id) {
                    offices.push(office.clone());
                }
            }
        }
    } else {
        // List all offices the user is a member of
        for domain_id_key in user.permissions.keys() {
            if let Some(Domain::Office { office, .. }) = tx.get_domain(domain_id_key) {
                if tx
                    .is_member_of_domain(user_id, domain_id_key)
                    .unwrap_or(false)
                {
                    offices.push(office.clone());
                }
            }
        }
    }
    info!(user_id = user_id, count = offices.len(), "Listed offices");
    Ok(offices)
}
