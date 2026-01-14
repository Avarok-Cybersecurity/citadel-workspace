use crate::handlers::domain::{DomainOperations, EntityOperations};
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;

// Office-related command handlers using the domain abstraction
// Office handlers - functions for creating, updating, and querying workspace offices

impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Use the domain abstraction for creating an office
        self.domain_operations.create_domain_entity::<Office>(
            user_id,
            Some(workspace_id),
            name,
            description,
            mdx_content,
        )
    }

    pub fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the domain abstraction for deleting an office
        self.domain_operations
            .delete_domain_entity::<Office>(user_id, office_id)
    }

    pub fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Use the domain abstraction for updating an office
        self.domain_operations.update_domain_entity::<Office>(
            user_id,
            office_id,
            name,
            description,
            mdx_content,
        )
    }

    pub fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the domain abstraction for getting an office
        self.domain_operations
            .get_domain_entity::<Office>(user_id, office_id)
    }

    /// List all offices
    pub fn list_offices(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<Office>, NetworkError> {
        // Use the domain abstraction for listing all offices
        self.domain_operations
            .list_domain_entities::<Office>(user_id, parent_id)
    }
}
