pub mod office_ops {
    use crate::handlers::domain::functions::room::room_ops;
    use crate::handlers::domain::permission_denied;
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{error, info, warn};
    use citadel_sdk::prelude::*;
    use citadel_workspace_types::structs::{Domain, Office, Permission, UserRole}; // Added import

    pub(crate) fn create_office_inner(
        tx: &mut dyn Transaction,
        user_id: &str,      // User creating the office
        workspace_id: &str, // Workspace this office belongs to
        office_id: &str,    // Pre-generated office ID
        name: &str,
        description: &str,
    ) -> Result<Office, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

        // Permission check: User needs CreateOffice permission on the parent workspace
        if !user.has_permission(workspace_id, Permission::CreateOffice) {
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
            owner_id: user_id.to_string(),
            workspace_id: workspace_id.to_string(), // Set the workspace_id
            name: name.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()], // Creator is the first member
            rooms: Vec::new(),                  // Starts with no rooms
            mdx_content: String::new(),         // Default empty MDX content
            metadata: Vec::new(),               // Default empty metadata
        };

        // Create the domain entry for the office
        let office_domain = Domain::Office {
            office: new_office.clone(),
        }; // Corrected Domain variant usage
        tx.insert_domain(office_id.to_string(), office_domain)?; // Use insert_domain

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

    pub(crate) fn get_office_inner(
        tx: &dyn Transaction,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

        if !tx.is_member_of_domain(&user.id, office_id)? {
            return Err(permission_denied(format!(
                "User {} is not a member of office {}",
                user_id, office_id
            )));
        }

        let domain = tx.get_domain(office_id).ok_or_else(|| {
            NetworkError::msg(format!("Domain for office {} not found", office_id))
        })?;

        domain
            .as_office()
            .cloned()
            .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", office_id)))
    }

    pub(crate) fn update_office_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        office_id: &str,
        name: Option<String>,
        description: Option<String>,
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

        let updated_office_clone = office_to_update.clone();
        tx.update_domain(office_id, owned_domain)?;

        info!(
            user_id = user_id,
            office_id = office_id,
            "Updated office {:?}",
            updated_office_clone.name
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
            Domain::Office { office } => (Some(office.workspace_id.clone()), office.rooms.clone()), // Get workspace_id from office struct
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
                    if let Some(domain) = tx.get_domain(off_id) {
                        if let Some(office) = domain.as_office() {
                            offices.push(office.clone());
                        }
                    }
                }
            }
        } else {
            // List all offices the user is a member of
            for domain_id_key in user.permissions.keys() {
                if let Some(domain) = tx.get_domain(domain_id_key) {
                    if let Domain::Office { office, .. } = domain {
                        // Confirm membership via tx method for consistency, though permissions.keys() implies some level of access
                        if tx
                            .is_member_of_domain(&user.id, &office.id)
                            .unwrap_or(false)
                        {
                            offices.push(office.clone());
                        }
                    }
                }
            }
        }
        info!(user_id = user_id, count = offices.len(), "Listed offices");
        Ok(offices)
    }

    pub(crate) fn add_user_to_office_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_id_to_add: &str,
        office_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
        if !admin_user.has_permission(office_id, Permission::ManageOfficeMembers) {
            return Err(permission_denied(format!(
                "Admin user {} cannot manage members in office {}",
                admin_id, office_id
            )));
        }
        let _user_to_add = tx.get_user(user_id_to_add).ok_or_else(|| {
            NetworkError::msg(format!("User to add {} not found", user_id_to_add))
        })?;

        tx.add_user_to_domain(user_id_to_add, office_id, role.clone())?;
        info!(admin_id, user_id_to_add, office_id, role = ?role, "Added user to office");
        Ok(())
    }

    pub(crate) fn remove_user_from_office_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_id_to_remove: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
        if !admin_user.has_permission(office_id, Permission::ManageOfficeMembers) {
            return Err(permission_denied(format!(
                "Admin user {} cannot manage members in office {}",
                admin_id, office_id
            )));
        }
        let user_to_remove = tx.get_user(user_id_to_remove).ok_or_else(|| {
            NetworkError::msg(format!("User to remove {} not found", user_id_to_remove))
        })?;

        if user_to_remove.role == UserRole::Owner {
            let owners_in_office_count = tx
                .get_all_users()
                .values()
                .filter(|u| {
                    tx.is_member_of_domain(&u.id, office_id).unwrap_or(false)
                        && u.role == UserRole::Owner
                })
                .count();

            if owners_in_office_count <= 1 {
                return Err(NetworkError::msg(
                    "Cannot remove the last owner from the office. Assign another owner first.",
                ));
            }
        }

        tx.remove_user_from_domain(user_id_to_remove, office_id)?;
        info!(
            admin_id,
            user_id_to_remove, office_id, "Removed user from office"
        );
        Ok(())
    }

    pub(crate) fn add_room_to_office_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        office_id: &str,
        room_id: &str,
    ) -> Result<(), NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        if !user.has_permission(office_id, Permission::UpdateOffice) {
            return Err(permission_denied(format!(
                "User {} cannot add room to office {}",
                user_id, office_id
            )));
        }
        // Ensure room exists and is a valid domain
        let _room_domain = tx
            .get_domain(room_id)
            .ok_or_else(|| NetworkError::msg(format!("Room domain {} not found", room_id)))?;

        let mut office_owned_domain = tx
            .get_domain(office_id)
            .ok_or_else(|| NetworkError::msg(format!("Office domain {} not found", office_id)))?
            .clone();

        let office_obj = office_owned_domain
            .as_office_mut()
            .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", office_id)))?;

        let room_id_string = room_id.to_string();
        if !office_obj.rooms.contains(&room_id_string) {
            office_obj.rooms.push(room_id_string);
        }

        tx.update_domain(office_id, office_owned_domain)?;
        info!(user_id, office_id, room_id, "Added room to office");
        Ok(())
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
