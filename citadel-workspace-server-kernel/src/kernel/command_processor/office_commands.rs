use crate::handlers::domain::{DomainOperations, OfficeOperations};
use crate::kernel::WorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;
use serde_json;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // ═══════════════════════════════════════════════════════════════════════════════════
    // OFFICE COMMAND HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════════════

    /// Handle CreateOffice command
    pub(crate) fn handle_create_office(
        &self,
        actor_user_id: &str,
        workspace_id: String,
        name: String,
        description: String,
        mdx_content: Option<String>,
        _metadata: Option<Vec<u8>>,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        Self::handle_result(
            self.domain_ops().create_office(
                actor_user_id,
                &workspace_id,
                &name,
                &description,
                mdx_content.as_deref(),
            ),
            WorkspaceProtocolResponse::Office,
            "Failed to create office",
        )
    }

    /// Handle GetOffice command
    pub(crate) fn handle_get_office(
        &self,
        actor_user_id: &str,
        office_id: String,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        self.get_office_command_internal(actor_user_id, &office_id)
    }

    /// Handle DeleteOffice command
    pub(crate) fn handle_delete_office(
        &self,
        actor_user_id: &str,
        office_id: String,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        Self::handle_result(
            self.domain_ops().delete_office(actor_user_id, &office_id),
            |_| WorkspaceProtocolResponse::Success("Office deleted successfully".to_string()),
            "Failed to delete office",
        )
    }

    /// Handle UpdateOffice command
    pub(crate) fn handle_update_office(
        &self,
        actor_user_id: &str,
        office_id: String,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
        _metadata: Option<Vec<u8>>,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        Self::handle_result(
            self.update_office_command_internal(
                actor_user_id,
                &office_id,
                name.as_deref(),
                description.as_deref(),
                mdx_content.as_deref(),
            ),
            WorkspaceProtocolResponse::Office,
            "Failed to update office",
        )
    }

    /// Handle ListOffices command
    pub(crate) fn handle_list_offices(
        &self,
        actor_user_id: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        Self::handle_result(
            self.domain_ops().list_offices(actor_user_id, None),
            WorkspaceProtocolResponse::Offices,
            "Failed to list offices",
        )
    }

    // ═══════════════════════════════════════════════════════════════════════════════════
    // EXISTING OFFICE OPERATIONS (kept for backward compatibility)
    // ═══════════════════════════════════════════════════════════════════════════════════

    /// Get an office by ID and process its data
    pub(crate) fn get_office_command_internal(
        &self,
        actor_user_id: &str,
        office_id: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        // Get the office details
        let office_json_string = self.domain_ops().get_office(actor_user_id, office_id)?;

        // Process and return the office data
        match serde_json::from_str::<Office>(&office_json_string) {
            Ok(office_struct) => Ok(WorkspaceProtocolResponse::Office(office_struct)),
            Err(e) => {
                let err_msg = format!(
                    "Internal error: Failed to process office data on retrieval: {}",
                    e
                );
                error!(
                    "Failed to deserialize office JSON from get_office: {}. JSON: {}",
                    e, office_json_string
                );
                Ok(WorkspaceProtocolResponse::Error(err_msg))
            }
        }
    }

    /// Update an office with new details
    pub(crate) fn update_office_command_internal(
        &self,
        actor_user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Call the domain operation to update the office
        self.domain_ops()
            .update_office(actor_user_id, office_id, name, description, mdx_content)
    }
}
