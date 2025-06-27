use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::functions::office::office_ops;
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::rbac::transaction_operations::TransactionManagerExt;

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Office, Permission};
use serde_json;

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new office within a workspace (internal implementation)
    pub(crate) fn create_office_internal(
        &self,
        user_id: &str,
        workspace_id: &str, // parent_id
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to create offices in this workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create office in workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Create the office
            let office = office_ops::create_office(tx, workspace_id, name, description, mdx_content)?;
            
            // Add the creating user to the office with admin privileges
            office_ops::add_user_to_office(tx, user_id, &office.id)?;
            
            Ok(office)
        })
    }

    /// Get office by ID (internal implementation)
    pub(crate) fn get_office_internal(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        // Use the trait implementation to get the office by delegating to DomainOperations::get_office
        // This properly handles permissions and existence checks
        self.get_office(user_id, office_id)
    }

    /// Update office details (internal implementation)
    pub(crate) fn update_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to update this office
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }

            // Update the office
            office_ops::update_office(tx, office_id, name, description, mdx_content)
        })
    }

    /// Delete an office (internal implementation)
    pub(crate) fn delete_office_internal(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to delete this office
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }

            // Delete the office
            office_ops::delete_office(tx, office_id)
        })
    }

    /// List offices, optionally filtering by workspace (internal implementation)
    pub(crate) fn list_offices_internal(
        &self,
        user_id: &str,
        workspace_id_opt: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If workspace ID is specified, check permissions
            if let Some(workspace_id) = &workspace_id_opt {
                if !self.check_entity_permission(tx, user_id, workspace_id, Permission::ViewContent)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list offices in workspace '{}'",
                        user_id, workspace_id
                    )));
                }
            }

            // List the offices
            office_ops::list_offices(tx, workspace_id_opt.as_deref(), Some(user_id))
        })
    }

    /// List offices within a specific workspace (internal implementation)
    pub(crate) fn list_offices_in_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        // Reuse list_offices with a workspace filter
        self.list_offices_internal(user_id, Some(workspace_id.to_string()))
    }
    
    /// List members of a specific office (internal implementation)
    pub(crate) fn list_office_members_internal(&self, office_id: &str) -> Result<Vec<(String, String)>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            office_ops::list_office_members(tx, office_id)
        })
    }
}
