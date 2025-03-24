use citadel_sdk::prelude::{NetworkError, Ratchet};
use crate::structs::Room;
use crate::kernel::WorkspaceServerKernel;
use crate::handlers::domain_ops::DomainOperations;

/// Room-related command handlers using the domain abstraction
impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Create a new room in an office
    pub fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Room, NetworkError> {
        // Verify the user is a member of the office
        self.with_read_transaction(|txn| {
            if !txn.is_member_of_domain(user_id, office_id)? {
                return Err(NetworkError::msg("User is not a member of the office"));
            }

            // Use the domain abstraction for creating a room
            self.create_domain_entity::<Room>(
                user_id,
                Some(office_id),
                name,
                description,
            )
        })
    }

    /// Delete a room
    pub fn delete_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        self.delete_domain_entity::<Room>(user_id, room_id)
    }

    /// Update a room's properties
    pub fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Use the domain abstraction for updating a room
        self.update_domain_entity::<Room>(user_id, room_id, name, description)
    }

    /// Get a room by ID
    pub fn get_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        // Use the domain abstraction for getting a room
        self.get_domain_entity::<Room>(user_id, room_id)
    }

    /// List all rooms in a specific office
    pub fn list_rooms(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Vec<Room>, NetworkError> {
        // Verify the user is a member of the office first
        if !self.is_member_of_domain(user_id, office_id)? {
            return Err(NetworkError::msg("User is not a member of the office"));
        }

        // Use the domain abstraction for listing entities of Room type with office_id as parent
        self.list_domain_entities::<Room>(user_id, Some(office_id))
    }

    /// List all rooms across all offices
    pub fn list_all_rooms(&self, user_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the domain abstraction for listing all rooms (no parent filter)
        self.list_domain_entities::<Room>(user_id, None)
    }
}
