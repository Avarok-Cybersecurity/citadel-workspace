use crate::handlers::domain::{DomainOperations, EntityOperations};
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Room;

/// Room-related command handlers using the domain abstraction
impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new room in an office
    pub fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.domain_operations.create_domain_entity::<Room>(
            user_id,
            Some(office_id),
            name,
            description,
            mdx_content,
        )
    }

    /// Delete a room
    pub fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.domain_operations
            .delete_domain_entity::<Room>(user_id, room_id)
    }

    /// Update a room's properties
    pub fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Use the domain abstraction for updating a room
        self.domain_operations.update_domain_entity::<Room>(
            user_id,
            room_id,
            name,
            description,
            mdx_content,
        )
    }

    /// Get a room by ID
    pub fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Use the domain abstraction for getting a room
        self.domain_operations
            .get_domain_entity::<Room>(user_id, room_id)
    }

    /// List all rooms in a specific office
    pub fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the domain abstraction for listing entities of Room type with office_id as parent
        self.domain_operations
            .list_domain_entities::<Room>(user_id, Some(office_id))
    }

    /// List all rooms across all offices
    pub fn list_all_rooms(&self, user_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the domain abstraction for listing all rooms (no parent filter)
        self.domain_operations
            .list_domain_entities::<Room>(user_id, None)
    }
}
