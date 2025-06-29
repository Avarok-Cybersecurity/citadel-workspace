use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;
use serde_json;

impl<R: Ratchet> WorkspaceServerKernel<R> {
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
