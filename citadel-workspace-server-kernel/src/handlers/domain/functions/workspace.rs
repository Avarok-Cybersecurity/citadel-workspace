use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Permission, Workspace};
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::server_ops::ServerDomainOps;
use crate::kernel::transaction::Transaction;

impl<R: Ratchet> ServerDomainOps<R> {
    pub fn update_workspace_inner(&self, user_id: &str, name: Option<&str>, description: Option<&str>, metadata: Option<Vec<u8>>) -> Result<Workspace, NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspaces
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot update workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg(format!("Workspace not found")))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Update the workspace fields
            if let Some(name_val) = name {
                workspace.name = name_val.to_string();
            }

            if let Some(desc_val) = description {
                workspace.description = desc_val.to_string();
            }

            if let Some(metadata_val) = metadata {
                workspace.metadata = metadata_val;
            }

            // Store the updated workspace
            tx.insert_domain(
                workspace_id,
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            Ok(workspace)
        })
    }

    pub fn delete_workspace_inner(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        // Use fixed workspace-root ID
        let actual_workspace_id = crate::WORKSPACE_ROOT_ID;

        // Ensure user has permission to delete workspaces
        if !self.check_entity_permission(
            user_id,
            &actual_workspace_id,
            Permission::DeleteWorkspace,
        )? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot delete workspace",
            ));
        }

        // Get the workspace first to return it later
        let workspace = self.get_workspace(user_id, &actual_workspace_id)?;

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&actual_workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            if let Domain::Workspace { workspace } = domain {
                // First collect all office IDs to avoid borrowing issues
                let office_ids: Vec<String> = workspace.offices.clone();

                // Then delete all offices
                for office_id in &office_ids {
                    let _ = tx.remove_domain(office_id)?;
                }
            }

            // Delete the workspace itself
            let _ = tx.remove_domain(&actual_workspace_id)?;

            Ok(())
        })?;

        // Return the workspace that was deleted
        Ok(workspace)
    }

    pub fn create_workspace_inner(&self, user_id: &str, name: &str, description: &str, metadata: Option<Vec<u8>>) -> Result<Workspace, NetworkError> {
        // Ensure user has permission to create workspaces
        if !self.check_entity_permission(user_id, "global", Permission::CreateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot create workspace",
            ));
        }

        // Check if a workspace already exists
        let existing_workspace = self.with_read_transaction(|tx| {
            let workspaces = tx.get_all_workspaces();
            Ok(!workspaces.is_empty())
        })?;

        if existing_workspace {
            return Err(NetworkError::msg(
                "A workspace already exists. Only one workspace is allowed in the system.",
            ));
        }

        // Generate a unique ID for the new workspace
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        let metadata = metadata.unwrap_or_default();

        match self.with_write_transaction(move |tx| {
            // Create the workspace
            let workspace = Workspace {
                id: workspace_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()],
                offices: Vec::new(),
                metadata,
            };

            // Add the workspace to the transaction
            tx.insert_domain(
                workspace_id.clone(),
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            Ok(workspace)
        }) {
            Ok(result) => Ok(result),
            Err(err) => Err(err),
        }
    }

    pub fn get_workspace_inner(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        let perm_kernel = self.tx_manager.clone();
        let actual_workspace_id = crate::WORKSPACE_ROOT_ID;

        self.with_read_transaction(move |tx| {
            let domain = tx
                .get_domain(&actual_workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found".to_string()))?;

            match domain {
                Domain::Workspace { workspace } => {
                    // Check if user has permission to access the workspace
                    if perm_kernel.is_admin(user_id)
                        || workspace.members.contains(&user_id.to_string())
                    {
                        Ok(workspace.clone())
                    } else {
                        Err(NetworkError::msg("Not authorized to access this workspace"))
                    }
                }
                _ => Err(NetworkError::msg("Domain is not a workspace")),
            }
        })
    }
}