pub mod office_ops {
    use crate::handlers::domain::functions::room::room_ops;
    use crate::handlers::domain::permission_denied;
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{debug, error, info, warn};
    use citadel_sdk::prelude::*;
    use citadel_workspace_types::structs::{Domain, Office, Permission, UserRole};
    
    pub(crate) fn create_office_inner(
        tx: &mut dyn Transaction,
        user_id: &str,      // User creating the office
        workspace_id: &str, // Workspace this office belongs to
        office_id: &str,    // Pre-generated office ID
        name: &str,
        description: &str,
        mdx_content: Option<String>, // Added mdx_content parameter
    ) -> Result<Office, NetworkError> {
    eprintln!( // <<< NEW LOG INSERTED HERE
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
                    if tx.is_member_of_domain(user_id, domain_id_key).unwrap_or(false) {
                        offices.push(office.clone());
                    }
                }
            }
        }
        info!(user_id = user_id, count = offices.len(), "Listed offices");
        Ok(offices)
    }

    // Placeholder for remove_room_from_office_inner - its logic might be integrated elsewhere or refactored
    #[allow(dead_code)] // Marking as dead_code for now as its usage is under review
    pub(crate) fn remove_room_from_office_inner(
        _tx: &mut dyn Transaction, // Prefixed with _ as it's unused, logic under review
        office_id: &str,
        room_id: &str,
    ) -> Result<(), NetworkError> {
        // This function's logic is largely covered by room_ops::delete_room_inner,
        // where the room updates its parent office. If specific direct manipulation
        // of an office to remove a room (without deleting the room) is needed,
        // this function would be implemented differently.
        warn!(
            office_id = office_id,
            room_id = room_id,
            "remove_room_from_office_inner called, potentially redundant or needs specific implementation"
        );
        // Example: if just removing from list without deleting room entity:
        // let mut office_domain = tx.get_domain_mut(office_id)?.ok_or_else(...)?.clone(); // or get_domain + clone
        // if let Domain::Office { office, .. } = &mut office_domain {
        //     office.room_ids.retain(|id| id != room_id);
        // }
        // tx.update_domain(office_id, office_domain)?;
        Ok(())
    }
}
