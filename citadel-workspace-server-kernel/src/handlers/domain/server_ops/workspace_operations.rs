use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::functions::workspace::workspace_ops;
use crate::handlers::domain::WorkspaceDBList;
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;
use crate::WORKSPACE_ROOT_ID;

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Workspace, UserRole, Permission};
use uuid::Uuid;

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
        self.tx_manager.with_write_transaction(|tx| {
            // Only admin can create workspaces
            self.is_admin(tx, user_id)?;

            // Create a new workspace ID with a UUID
            let workspace_id = Uuid::new_v4().to_string();

            // Create the workspace
            workspace_ops::create_workspace(
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
    pub(crate) fn get_workspace_details_internal(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check permissions
            if !self.check_entity_permission(tx, user_id, ws_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access workspace '{}'",
                    user_id, ws_id
                )));
            }

            // Get the workspace
            workspace_ops::get_workspace(tx, ws_id)
        })
    }

    /// Delete a workspace (admin only with password verification) (internal implementation)
    pub(crate) fn delete_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Only admin can delete workspaces
            if !self.is_admin(tx, user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' not allowed to delete workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Verify the workspace password
            workspace_ops::verify_workspace_password(tx, &workspace_password)?;

            // Delete the workspace
            workspace_ops::delete_workspace(tx, workspace_id)?;
            
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
        self.tx_manager.with_write_transaction(|tx| {
            // Only admin can update workspaces
            if !self.is_admin(tx, user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' not allowed to update workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Verify the workspace password
            workspace_ops::verify_workspace_password(tx, &workspace_password)?;

            // Update the workspace
            workspace_ops::update_workspace(tx, workspace_id, name, description, _metadata)
        })
    }

    /// Associate an office with a workspace (internal implementation)
    pub(crate) fn add_office_to_workspace_internal(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        // Not implemented or not needed
        Err(NetworkError::msg("Not implemented"))
    }

    /// Remove an office from a workspace (internal implementation)
    pub(crate) fn remove_office_from_workspace_internal(
        &self,
        _user_id: &str,
        _workspace_id: &str,
        _office_id: &str,
    ) -> Result<(), NetworkError> {
        // Not implemented or not needed
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
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission
            if !self.is_admin(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to workspace",
                    admin_id
                )));
            }

            // Add user to workspace
            workspace_ops::add_user_to_workspace(tx, user_id, workspace_id, role)
        })
    }

    /// Remove a user from a workspace (internal implementation)
    pub(crate) fn remove_user_from_workspace_internal(
        &self,
        admin_id: &str,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission
            if !self.is_admin(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from workspace",
                    admin_id
                )));
            }

            // Remove user from workspace
            workspace_ops::remove_user_from_workspace(tx, user_id, workspace_id)
        })
    }

    /// Load workspace details, creating if needed (internal implementation)
    pub(crate) fn load_workspace_internal(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        let workspace_id = workspace_id_opt.unwrap_or(WORKSPACE_ROOT_ID);

        self.tx_manager.with_read_transaction(|tx| {
            // Check if workspace exists
            if let Some(workspace) = tx.get_workspace(workspace_id) {
                // Check if user has permission
                if self.check_entity_permission(tx, user_id, workspace_id, Permission::ViewContent)? {
                    return Ok(workspace.clone());
                }
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            Err(NetworkError::msg(format!(
                "Workspace '{}' not found",
                workspace_id
            )))
        })
    }

    /// List all workspaces accessible to the user (internal implementation)
    pub(crate) fn list_workspaces_internal(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            // For now, we just return the root workspace if the user has access
            if self.check_entity_permission(tx, user_id, WORKSPACE_ROOT_ID, Permission::ViewContent)? {
                if let Some(workspace) = tx.get_workspace(WORKSPACE_ROOT_ID) {
                    return Ok(vec![workspace.clone()]);
                }
            }

            Ok(Vec::new())
        })
    }

    /// Get all workspace IDs (admin function) (internal implementation)
    pub(crate) fn get_all_workspace_ids_internal(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            let workspace_ids = tx.get_all_workspace_ids()?;
            Ok(workspace_ids)
        })
    }
}
