use crate::handlers::domain::functions::workspace::workspace_ops;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::WorkspaceDBList;
use crate::handlers::domain::{DomainOperations, TransactionOperations};
use crate::kernel::transaction::{Transaction, TransactionManagerExt};
use crate::WORKSPACE_ROOT_ID;

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole, Workspace};
use uuid::Uuid;

#[allow(dead_code)]
impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new workspace with the given parameters (internal implementation)
    pub(crate) fn create_workspace_internal(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.with_write_transaction(|tx| {
            self.is_admin(tx, user_id)?;

            let workspace_id = Uuid::new_v4().to_string();

            workspace_ops::create_workspace_inner(
                tx,
                &workspace_id,
                name,
                description,
                metadata,
                workspace_password,
            )
        })
    }

    /// Get detailed workspace information (internal implementation)
    pub(crate) fn get_workspace_details_internal(
        &self,
        user_id: &str,
        ws_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.with_read_transaction(|tx| {
            if !self.check_entity_permission_impl(tx, user_id, ws_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access workspace '{}'",
                    user_id, ws_id
                )));
            }

            tx.get_workspace(ws_id)
                .ok_or_else(|| NetworkError::msg(format!("Workspace '{}' not found", ws_id)))
                .cloned()
        })
    }

    /// Delete a workspace (admin only with password verification) (internal implementation)
    pub(crate) fn delete_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(tx, user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' not allowed to delete workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let stored_password = tx
                .workspace_password(workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace password not found"))?;
            if stored_password != workspace_password {
                return Err(NetworkError::msg("Incorrect workspace password"));
            }

            workspace_ops::delete_workspace_inner(tx, user_id, workspace_id)?;

            Ok(())
        })
    }

    /// Update workspace details (internal implementation)
    pub(crate) fn update_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        _metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(tx, user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' not allowed to update workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let stored_password = tx
                .workspace_password(workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace password not found"))?;
            if stored_password != workspace_password {
                return Err(NetworkError::msg("Incorrect workspace password"));
            }

            let workspace = tx.get_workspace_mut(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if let Some(new_name) = name {
                workspace.name = new_name.to_string();
            }

            if let Some(new_description) = description {
                workspace.description = new_description.to_string();
            }

            if let Some(metadata) = _metadata {
                workspace.metadata = metadata;
            }

            Ok(workspace.clone())
        })
    }

    /// Associate an office with a workspace (internal implementation)
    pub(crate) fn add_office_to_workspace_internal(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Not implemented"))
    }

    /// Remove an office from a workspace (internal implementation)
    pub(crate) fn remove_office_from_workspace_internal(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Not implemented"))
    }

    /// Add a user to a workspace with a specific role (internal implementation)
    pub(crate) fn add_user_to_workspace_internal(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to workspace",
                    admin_id
                )));
            }

            workspace_ops::add_user_to_workspace_inner(tx, admin_id, user_id, workspace_id, role)
        })
    }

    /// Remove a user from a workspace (internal implementation)
    pub(crate) fn remove_user_from_workspace_internal(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            if !self.is_admin(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from workspace",
                    admin_id
                )));
            }

            workspace_ops::remove_user_from_workspace_inner(tx, admin_id, user_id, workspace_id)
        })
    }

    /// Load a workspace by ID, or the first available workspace if no ID is provided (internal implementation)
    pub(crate) fn load_workspace_internal(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.with_read_transaction(|tx| {
            if let Some(workspace_id) = workspace_id_opt {
                if !self.check_entity_permission_impl(
                    tx,
                    user_id,
                    workspace_id,
                    Permission::ViewContent,
                )? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to access workspace '{}'",
                        user_id, workspace_id
                    )));
                }

                tx.get_workspace(workspace_id)
                    .ok_or_else(|| {
                        NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
                    })
                    .cloned()
            } else if let Some(workspace) = tx.get_workspace(WORKSPACE_ROOT_ID) {
                Ok(workspace.clone())
            } else {
                Err(NetworkError::msg("No workspace found"))
            }
        })
    }

    /// List all workspaces accessible to the user (internal implementation)
    pub(crate) fn list_workspaces_internal(
        &self,
        user_id: &str,
    ) -> Result<Vec<Workspace>, NetworkError> {
        self.with_read_transaction(|tx| {
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            let workspaces = tx.get_all_workspaces();

            let mut accessible_workspaces = Vec::new();
            for workspace in workspaces.values() {
                if self.check_entity_permission_impl(
                    tx,
                    user_id,
                    &workspace.id,
                    Permission::ViewContent,
                )? {
                    accessible_workspaces.push(workspace.clone());
                }
            }

            Ok(accessible_workspaces)
        })
    }

    /// Get all workspace IDs (internal implementation)
    pub(crate) fn get_all_workspace_ids_internal(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.with_read_transaction(|tx| {
            let workspaces = tx.get_all_workspaces();
            let workspace_ids: Vec<String> = workspaces.keys().cloned().collect();
            Ok(WorkspaceDBList {
                workspaces: workspace_ids,
            })
        })
    }
}
