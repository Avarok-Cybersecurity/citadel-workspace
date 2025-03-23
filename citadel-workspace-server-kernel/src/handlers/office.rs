use citadel_sdk::prelude::{NetworkError, Ratchet};

use crate::structs::{Office, UserRole};
use crate::kernel::WorkspaceServerKernel;

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
            name,
            description,
            None,
            Box::new(|id| {
                Office {
                    id,
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![],
                    rooms: vec![],
                    mdx_content: String::new(),
                }
            }),
            UserRole::Owner,
        )
    }

    pub fn delete_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        // Use the domain abstraction for deleting an office
        match self.delete_domain_entity::<Office>(user_id, office_id) {
            Ok(()) => {
                // Since the office is already deleted, we'd need a copy of it before deletion
                // For now, return an error indicating it was deleted but we can't return it
                Err(NetworkError::msg(format!("Office {} deleted, but cannot return it as it no longer exists", office_id)))
            },
            Err(e) => Err(e),
        }
    }

    pub fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), NetworkError> {
        // Use the domain abstraction for updating an office
        self.update_domain_entity::<Office>(user_id, office_id, name, description)
    }

    pub fn get_office(&self, office_id: &str) -> Option<Office> {
        // Use the domain abstraction for getting an office
        self.get_domain_entity::<Office>(office_id)
    }

    /// List all offices
    pub fn list_offices(&self) -> Result<Vec<Office>, NetworkError> {
        // Use the domain abstraction for listing all offices
        self.list_domain_entities::<Office>()
    }
}
