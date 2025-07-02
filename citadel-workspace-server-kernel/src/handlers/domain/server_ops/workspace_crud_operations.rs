use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::{TransactionOperations, WorkspaceDBList};
use crate::kernel::transaction::TransactionManagerExt;
use bcrypt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Office, Permission, Workspace};
use uuid::Uuid;

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    pub fn get_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.with_read_transaction(|tx| {
            // Check if user has permission to view this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::ViewContent,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view workspace '{}'",
                    user_id, workspace_id
                )));
            }

            if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                Ok(workspace.clone())
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }

    pub fn get_workspace_details_impl(
        &self,
        user_id: &str,
        ws_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.get_workspace_impl(user_id, ws_id)
    }

    pub fn create_workspace_impl(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if a root workspace already exists
            let found_root_ws = tx.get_workspace(crate::WORKSPACE_ROOT_ID);
            let root_ws_exists = found_root_ws.is_some();
            if root_ws_exists {
                return Err(NetworkError::msg(
                    "A root workspace already exists. Cannot create another one.",
                ));
            }

            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            let workspace_id = Uuid::new_v4().to_string();
            let mut workspace = Workspace {
                id: workspace_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()],
                offices: Vec::new(),
                metadata: Default::default(),
                password_protected: !workspace_password.is_empty(),
            };

            // Set workspace password if provided
            if !workspace_password.is_empty() {
                tx.set_workspace_password(&workspace_id, &workspace_password)?;
            }

            // Set metadata if provided
            if let Some(metadata) = metadata {
                workspace.metadata = metadata;
            }

            // Insert the workspace
            tx.insert_workspace(workspace_id.clone(), workspace.clone())?;

            // Create the corresponding domain
            let domain = citadel_workspace_types::structs::Domain::Workspace {
                workspace: workspace.clone(),
            };
            tx.insert_domain(workspace_id.clone(), domain)?;

            // Add the creator as a member
            tx.add_user_to_domain(
                user_id,
                &workspace_id,
                citadel_workspace_types::structs::UserRole::Owner,
            )?;

            Ok(workspace)
        })
    }

    pub fn add_office_to_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to add offices to this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::AddOffice,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add offices to workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if the office exists
            if tx.get_office(office_id).is_none() {
                return Err(NetworkError::msg(format!(
                    "Office '{}' not found",
                    office_id
                )));
            }

            // Check if the workspace exists and update it
            if let Some(mut workspace) = tx.get_workspace(workspace_id).cloned() {
                if !workspace.offices.contains(&office_id.to_string()) {
                    workspace.offices.push(office_id.to_string());
                    tx.insert_workspace(workspace_id.to_string(), workspace)?;
                }
                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }

    pub fn remove_office_from_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to remove offices from this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::ManageDomains,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove offices from workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if the workspace exists and update it
            if let Some(mut workspace) = tx.get_workspace(workspace_id).cloned() {
                workspace.offices.retain(|id| id != office_id);
                tx.insert_workspace(workspace_id.to_string(), workspace)?;

                // Also remove the office itself
                tx.remove_office(office_id)?;
                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }

    pub fn list_workspaces_impl(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.with_read_transaction(|tx| tx.list_workspaces(user_id))
    }

    pub fn update_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if user has permission to update this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::UpdateWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Verify the workspace password if provided
            if !workspace_master_password.is_empty() {
                if let Some(stored_password_hash) = tx.workspace_password(workspace_id) {
                    if !bcrypt::verify(&workspace_master_password, &stored_password_hash)
                        .unwrap_or(false)
                    {
                        return Err(NetworkError::msg("Incorrect workspace master password"));
                    }
                } else {
                    return Err(NetworkError::msg("Workspace password required but not set"));
                }
            }

            // Get and update the workspace
            if let Some(mut workspace) = tx.get_workspace(workspace_id).cloned() {
                if let Some(name) = name {
                    workspace.name = name.to_string();
                }
                if let Some(description) = description {
                    workspace.description = description.to_string();
                }
                if let Some(metadata) = metadata {
                    workspace.metadata = metadata;
                }

                tx.update_workspace(workspace_id, workspace.clone())?;

                // Update the corresponding domain
                let domain = citadel_workspace_types::structs::Domain::Workspace {
                    workspace: workspace.clone(),
                };
                tx.insert_domain(workspace_id.to_string(), domain)?;

                Ok(workspace)
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }

    pub fn load_workspace_impl(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        use crate::WORKSPACE_ROOT_ID;

        let workspace_id = workspace_id_opt.unwrap_or(WORKSPACE_ROOT_ID);
        self.get_workspace_impl(user_id, workspace_id)
    }

    pub fn delete_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
        _workspace_password: String,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // System Protection: Prevent deletion of the root workspace
            if workspace_id == crate::WORKSPACE_ROOT_ID {
                return Err(NetworkError::msg("Cannot delete the root workspace"));
            }

            // Check if user has permission to delete this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::DeleteWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Get the workspace to check ownership
            if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                if workspace.owner_id != user_id {
                    return Err(NetworkError::msg(format!(
                        "Only the owner can delete workspace '{}'",
                        workspace_id
                    )));
                }

                // Remove all offices in the workspace first
                for office_id in &workspace.offices {
                    tx.remove_office(office_id)?;
                }

                // Remove the workspace
                tx.remove_workspace(workspace_id)?;

                // Remove the corresponding domain
                tx.remove_domain(workspace_id)?;

                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }

    pub fn get_all_workspace_ids_impl(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.with_read_transaction(|tx| {
            let workspaces = tx.get_all_workspaces();
            let workspace_ids: Vec<String> = workspaces.keys().cloned().collect();
            Ok(WorkspaceDBList {
                workspaces: workspace_ids,
            })
        })
    }

    pub fn list_offices_in_workspace_impl(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.with_read_transaction(|tx| {
            // Check if user has permission to view this workspace
            if !self.check_entity_permission_impl(
                tx,
                user_id,
                workspace_id,
                Permission::ViewContent,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view workspace '{}'",
                    user_id, workspace_id
                )));
            }

            if let Some(workspace) = tx.get_workspace(workspace_id).cloned() {
                let mut offices = Vec::new();
                for office_id in &workspace.offices {
                    if let Some(office) = tx.get_office(office_id) {
                        offices.push(office.clone());
                    }
                }
                Ok(offices)
            } else {
                Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )))
            }
        })
    }
}
