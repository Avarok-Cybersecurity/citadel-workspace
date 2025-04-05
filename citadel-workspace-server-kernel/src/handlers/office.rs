use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;

// Office-related command handlers using the domain abstraction
// Office handlers - functions for creating, updating, and querying workspace offices

impl<R: Ratchet> WorkspaceServerKernel<R> {
    pub fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Office, NetworkError> {
        // Use the domain abstraction for creating an office
        self.create_domain_entity::<Office>(
            user_id,
            None, // No parent for an office
            name,
            description,
        )
    }

    pub fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the domain abstraction for deleting an office
        self.delete_domain_entity::<Office>(user_id, office_id)
    }

    pub fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Use the domain abstraction for updating an office
        self.update_domain_entity::<Office>(user_id, office_id, name, description)
    }

    pub fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the domain abstraction for getting an office
        self.get_domain_entity::<Office>(user_id, office_id)
    }

    /// List all offices
    pub fn list_offices(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<Office>, NetworkError> {
        // Use the domain abstraction for listing all offices
        self.list_domain_entities::<Office>(user_id, parent_id)
    }
}
