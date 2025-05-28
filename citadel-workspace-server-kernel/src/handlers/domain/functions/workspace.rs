pub mod workspace_ops {
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{debug, error, info, warn};
    use citadel_sdk::prelude::NetworkError;
    use citadel_workspace_types::structs::{Domain, Permission, UserRole, Workspace};
    use serde::{Deserialize, Serialize};
    use uuid::Uuid;

    use crate::handlers::domain::permission_denied;

    /// Represents a list of workspace IDs, potentially for database list operations.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct WorkspaceDBList {
        pub workspaces: Vec<String>,
    }

    /// Represents a workspace ID and its password.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct WorkspacePasswordPair {
        pub workspace_id: String,
        pub password: String,
    }

    // NEW FUNCTION for creating a workspace
    pub(crate) fn create_workspace_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        // Ensure the user creating the workspace exists
        let _user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;

        let all_workspaces = tx.get_all_workspaces();
        if let Some(existing_workspace_id) = all_workspaces.keys().next() {
            // A workspace already exists, treat it as the root and validate password
            if let Some(stored_password) = tx.workspace_password(existing_workspace_id) {
                if stored_password == workspace_password {
                    info!(
                        "User '{}' accessed existing workspace '{}' with correct password",
                        user_id, existing_workspace_id
                    );
                    // Return the existing workspace DTO
                    return tx
                        .get_workspace(existing_workspace_id)
                        .cloned()
                        .ok_or_else(|| {
                            NetworkError::msg(format!(
                                "Existing workspace {} not found after check",
                                existing_workspace_id
                            ))
                        });
                } else {
                    warn!(
                        "User '{}' failed to access workspace '{}': Incorrect password",
                        user_id, existing_workspace_id
                    );
                    return Err(NetworkError::msg("Incorrect workspace master password"));
                }
            } else {
                // Should not happen if a workspace exists and is password protected
                warn!(
                    "Workspace '{}' exists but has no password set. Allowing creation for now.",
                    existing_workspace_id
                );
                // Or, could return an error: Err(NetworkError::msg("Existing workspace has no password, configuration error"))
            }
        }

        // No workspace exists, or existing one had no password (edge case handled by warning above)
        // Proceed to create a new one (this will be the first/root workspace)
        let new_workspace_id_uuid = Uuid::new_v4();
        let new_workspace_id_str = new_workspace_id_uuid.to_string();

        let new_workspace_dto = Workspace {
            id: new_workspace_id_str.clone(),
            name: name.to_string(),
            owner_id: user_id.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()],
            metadata: metadata.unwrap_or_else(Vec::new),
            offices: Vec::new(),
            password_protected: !workspace_password.is_empty(),
        };

        // Set password if provided (it should always be provided for the first workspace)
        if !workspace_password.is_empty() {
            tx.set_workspace_password(&new_workspace_id_str, &workspace_password)?;
        } else {
            // This case should ideally not be hit if we enforce password for the first workspace
            warn!(
                "Creating workspace '{}' without a password.",
                new_workspace_id_str
            );
        }

        // Insert the Workspace DTO into the transaction
        tx.insert_workspace(new_workspace_id_str.clone(), new_workspace_dto.clone())?;

        // Insert the domain entry for the workspace using the DTO
        tx.insert_domain(
            new_workspace_id_str.clone(),
            Domain::Workspace {
                workspace: new_workspace_dto.clone(),
            },
        )?;

        // Grant the creator Owner role for this new workspace domain
        tx.add_user_to_domain(user_id, &new_workspace_id_str, UserRole::Owner)?;

        info!(
            "User '{}' created new workspace '{}' with id '{}'",
            user_id, name, new_workspace_id_str
        );

        Ok(new_workspace_dto)
    }

    pub(crate) fn delete_workspace_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Permission check: User must have 'DeleteWorkspace' permission.
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        if !user.has_permission(workspace_id, Permission::DeleteWorkspace) {
            return Err(permission_denied(format!(
                "User {} does not have permission to delete workspace {}",
                user_id, workspace_id
            )));
        }

        // First, remove the domain entry
        tx.remove_domain(workspace_id)?;
        // Then, remove the workspace itself
        tx.remove_workspace(workspace_id)?;

        info!("Workspace {} deleted by user {}", workspace_id, user_id);
        Ok(())
    }

    pub(crate) fn add_user_to_workspace_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_to_add_id: &str,
        workspace_id: &str,
        role_name: &str,
    ) -> Result<(), NetworkError> {
        // Permission check: Admin must have 'AddUsers' permission.
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;

        debug!(target: "citadel", "[ADD_USER_TO_WORKSPACE_INNER_PERM_CHECK] admin_id: {}, workspace_id: {}, admin_user_role: {:?}, required_permission: {:?}", admin_id, workspace_id, admin_user.role, Permission::AddUsers);

        if !admin_user.has_permission(workspace_id, Permission::AddUsers) {
            error!(target: "citadel", "Admin {} does not have AddUsers permission for workspace {}", admin_id, workspace_id);
            return Err(permission_denied(format!(
                "Admin {} does not have permission to add users to workspace {}",
                admin_id, workspace_id
            )));
        }

        let mut workspace = tx
            .get_workspace_mut(workspace_id)
            .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", workspace_id)))?
            .clone();

        // Ensure the user to add exists
        let _ = tx.get_user(user_to_add_id).ok_or_else(|| {
            NetworkError::msg(format!("User to add {} not found", user_to_add_id))
        })?;

        if !workspace.members.contains(&user_to_add_id.to_string()) {
            workspace.members.push(user_to_add_id.to_string());
        } else {
            warn!(
                "User {} is already a member of workspace {}. Skipping addition.",
                user_to_add_id, workspace_id
            );
        }

        // Convert role_name string to UserRole enum
        let _role = match role_name {
            "Admin" => UserRole::Admin,
            "Owner" => UserRole::Owner,
            "Member" => UserRole::Member,
            "Guest" => UserRole::Guest,
            _ => {
                return Err(NetworkError::msg(format!(
                    "Invalid role name: {}",
                    role_name
                )))
            }
        };

        // Add user to domain (which might handle role assignments internally or require separate logic)
        // For now, we assume adding to workspace.members is the primary action here.
        // If roles are managed per-domain by the Transaction trait, use that:
        // tx.add_user_to_domain(user_to_add_id, workspace_id, role.clone())?;

        // Update the workspace with new member list
        tx.update_workspace(workspace_id, workspace.clone())?;
        // Also update the domain entry
        tx.update_domain(
            workspace_id,
            Domain::Workspace {
                workspace: workspace.clone(),
            },
        )?;

        info!(
            "Admin '{}' added user '{}' to workspace '{}' with role '{}'",
            admin_id, user_to_add_id, workspace_id, role_name
        );
        Ok(())
    }

    pub(crate) fn remove_user_from_workspace_inner(
        tx: &mut dyn Transaction,
        admin_id: &str,
        user_to_remove_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Permission check: Admin must have 'RemoveUsers' permission.
        let admin_user = tx
            .get_user(admin_id)
            .ok_or_else(|| NetworkError::msg(format!("Admin user {} not found", admin_id)))?;
        if !admin_user.has_permission(workspace_id, Permission::RemoveUsers) {
            return Err(permission_denied(format!(
                "Admin {} does not have permission to remove users from workspace {}",
                admin_id, workspace_id
            )));
        }

        let mut workspace = tx
            .get_workspace_mut(workspace_id)
            .ok_or_else(|| NetworkError::msg(format!("Workspace {} not found", workspace_id)))?
            .clone();

        // Ensure the user to remove exists and is a member
        if workspace.members.contains(&user_to_remove_id.to_string()) {
            // Prevent removing the last owner if that logic is desired here
            // This might be more complex if roles are granular within the workspace domain
            if workspace.owner_id == user_to_remove_id && workspace.members.len() == 1 {
                return Err(NetworkError::msg(format!(
                    "Cannot remove the last owner ({}) from workspace {}",
                    user_to_remove_id, workspace_id
                )));
            }
            workspace.members.retain(|id| id != user_to_remove_id);
        } else {
            return Err(NetworkError::msg(format!(
                "User {} not found in workspace {} or not a member",
                user_to_remove_id, workspace_id
            )));
        }

        // Update the workspace with the modified member list
        tx.update_workspace(workspace_id, workspace.clone())?;
        // Also update the domain entry
        tx.update_domain(
            workspace_id,
            Domain::Workspace {
                workspace: workspace.clone(),
            },
        )?;

        info!(
            "Admin '{}' removed user '{}' from workspace '{}'",
            admin_id, user_to_remove_id, workspace_id
        );
        Ok(())
    }

    // Gets all workspace IDs (primarily for internal server use)
    pub(crate) fn get_all_workspace_ids_inner(
        _tx: &dyn Transaction,
    ) -> Result<WorkspaceDBList, NetworkError> {
        let workspace_ids: Vec<String> = _tx.get_all_workspaces().keys().cloned().collect();

        Ok(WorkspaceDBList {
            workspaces: workspace_ids,
        })
    }
}
