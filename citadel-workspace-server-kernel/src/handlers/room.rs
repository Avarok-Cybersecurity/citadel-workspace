use citadel_sdk::prelude::{NetworkError, Ratchet};

use crate::structs::{Room, UserRole};
use crate::kernel::WorkspaceServerKernel;
use crate::handlers::transaction::TransactionManager;

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
                name,
                description,
                Some(office_id),
                Box::new(|id| {
                    Room {
                        id,
                        name: name.to_string(),
                        description: description.to_string(),
                        owner_id: user_id.to_string(),
                        members: vec![],
                        office_id: office_id.to_string(),
                        mdx_content: String::new(),
                    }
                }),
                UserRole::Owner,
            )
        })
    }

    /// Delete a room
    pub fn delete_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        match self.delete_domain_entity::<Room>(user_id, room_id) {
            Ok(()) => {
                // Since the room is already deleted, return an error indicating it was deleted
                Err(NetworkError::msg(format!("Room {} deleted, but cannot return it as it no longer exists", room_id)))
            },
            Err(e) => Err(e),
        }
    }

    /// Update a room's properties
    pub fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<(), NetworkError> {
        // Use the domain abstraction for updating a room
        self.update_domain_entity::<Room>(user_id, room_id, name, description)
    }

    /// Get a room by ID
    pub fn get_room(&self, room_id: &str) -> Option<Room> {
        // Use the domain abstraction for getting a room
        self.get_domain_entity::<Room>(room_id)
    }

    /// List all rooms in a specific office
    pub fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the domain abstraction for listing rooms in an office
        self.list_domain_entities_by_parent::<Room>(user_id, office_id)
    }

    /// List all rooms across all offices
    pub fn list_all_rooms(&self, user_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the domain abstraction for listing all rooms
        self.list_domain_entities::<Room>()
    }
}
