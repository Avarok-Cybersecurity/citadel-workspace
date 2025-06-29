use crate::handlers::domain::functions::office::office_ops;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainOperations;
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::TransactionManagerExt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Office, Permission};

#[allow(dead_code)]
impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new office within a workspace (internal implementation)
    pub(crate) fn create_office_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create office in workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let office_id = uuid::Uuid::new_v4().to_string();
            let mdx_content_string = mdx_content.map(|s| s.to_string());
            let office = office_ops::create_office_inner(
                tx,
                user_id,
                workspace_id,
                &office_id,
                name,
                description,
                mdx_content_string,
            )?;

            Ok(office)
        })
    }

    /// Get office by ID (internal implementation)
    pub(crate) fn get_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<String, NetworkError> {
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
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }

            let name_option = name.map(|s| s.to_string());
            let desc_option = description.map(|s| s.to_string());
            let mdx_option = mdx_content.map(|s| s.to_string());
            office_ops::update_office_inner(
                tx,
                user_id,
                office_id,
                name_option,
                desc_option,
                mdx_option,
            )
        })
    }

    /// Delete an office (internal implementation)
    pub(crate) fn delete_office_internal(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }

            office_ops::delete_office_inner(tx, user_id, office_id)
        })
    }

    /// List offices, optionally filtering by workspace (internal implementation)
    pub(crate) fn list_offices_internal(
        &self,
        user_id: &str,
        workspace_id_opt: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(workspace_id) = &workspace_id_opt {
                if !self.check_entity_permission(
                    tx,
                    user_id,
                    workspace_id,
                    Permission::ViewContent,
                )? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list offices in workspace '{}'",
                        user_id, workspace_id
                    )));
                }
            }

            let workspace_id_string = workspace_id_opt.map(|s| s.to_string());
            office_ops::list_offices_inner(tx, user_id, workspace_id_string)
        })
    }

    /// List offices within a specific workspace (internal implementation)
    pub(crate) fn list_offices_in_workspace_internal(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_offices_internal(user_id, Some(workspace_id.to_string()))
    }

    /// List members of a specific office (internal implementation)
    pub(crate) fn list_office_members_internal(
        &self,
        office_id: &str,
    ) -> Result<Vec<(String, String)>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(Domain::Office { office }) = tx.get_domain(office_id) {
                Ok(office
                    .members
                    .clone()
                    .into_iter()
                    .map(|id| (id.clone(), id))
                    .collect())
            } else {
                Err(NetworkError::msg(format!("Office {} not found", office_id)))
            }
        })
    }
}
