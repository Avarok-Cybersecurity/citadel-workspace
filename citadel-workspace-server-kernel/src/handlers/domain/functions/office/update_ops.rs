//! # Office Update Operations
//!
//! This module provides office update functionality for modifying
//! existing office properties including name, description, and MDX content.

use crate::handlers::domain::permission_denied;
use crate::kernel::transaction::Transaction;
use citadel_logging::info;
use citadel_sdk::prelude::*;
use citadel_workspace_types::structs::{Domain, Office, Permission};

/// Updates properties of an existing office.
///
/// This function allows modification of office properties including name, description,
/// and MDX content. Only provided fields will be updated, others remain unchanged.
/// Performs permission validation to ensure user has UpdateOffice permission.
///
/// # Arguments
/// * `tx` - Mutable transaction for database operations
/// * `user_id` - ID of the user performing the update (must have UpdateOffice permission)
/// * `office_id` - ID of the office to update
/// * `name` - Optional new name for the office
/// * `description` - Optional new description for the office
/// * `mdx_content` - Optional new MDX content for the office
///
/// # Returns
/// * `Ok(Office)` - Successfully updated office entity
/// * `Err(NetworkError)` - Permission denied or update failure
///
/// # Permission Requirements
/// - User must have `Permission::UpdateOffice` on the target office
/// - Office must exist and be accessible
#[allow(dead_code)]
pub(crate) fn update_office_inner(
    tx: &mut dyn Transaction,
    user_id: &str,
    office_id: &str,
    name: Option<String>,
    description: Option<String>,
    mdx_content: Option<String>, // Added mdx_content parameter
) -> Result<Office, NetworkError> {
    let user = tx
        .get_user(user_id)
        .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
    if !user.has_permission(office_id, Permission::UpdateOffice) {
        return Err(permission_denied(format!(
            "User {} cannot update office {}",
            user_id, office_id
        )));
    }

    let mut owned_domain = tx
        .get_domain(office_id)
        .ok_or_else(|| NetworkError::msg(format!("Domain for office {} not found", office_id)))?
        .clone();

    let office_to_update = match &mut owned_domain {
        Domain::Office { office, .. } => office,
        _ => {
            return Err(NetworkError::msg(format!(
                "Domain {} is not an office",
                office_id
            )))
        }
    };

    if let Some(n) = name {
        office_to_update.name = n;
    }
    if let Some(d) = description {
        office_to_update.description = d;
    }
    if let Some(mdx) = mdx_content {
        office_to_update.mdx_content = mdx;
    }

    let updated_office_clone = office_to_update.clone();
    tx.update_domain(office_id, owned_domain)?;

    info!(
        user_id = user_id,
        office_id = office_id,
        name = ?updated_office_clone.name,
        description = ?updated_office_clone.description,
        mdx_content_is_empty = updated_office_clone.mdx_content.is_empty(),
        "Updated office details"
    );
    Ok(updated_office_clone)
}
