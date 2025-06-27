use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::functions::room::room_ops;
use crate::kernel::transaction::TransactionManagerExt;

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Room, Permission};


impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Create a new room within an office (internal implementation)
    pub(crate) fn create_room_internal(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to create rooms in this office
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create room in office '{}'",
                    user_id, office_id
                )));
            }

            // Create the room
            // Generate a unique room ID
            let room_id = uuid::Uuid::new_v4().to_string();
            let mdx_content_string = mdx_content.map(|s| s.to_string());
            let room = room_ops::create_room_inner(tx, user_id, office_id, &room_id, name, description, mdx_content_string)?;
            
            // Add the creating user to the room with appropriate privileges
            // User is already added in create_room_inner
            
            Ok(room)
        })
    }

    /// Get room details by ID (internal implementation)
    pub(crate) fn get_room_internal(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Use the trait implementation to get the room by delegating to DomainOperations::get_room
        // This properly handles permissions and existence checks
        self.get_room(user_id, room_id)
    }

    /// Update room details (internal implementation)
    pub(crate) fn update_room_internal(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Remember: as per the memory, changes made during a transaction are immediately applied
        // to in-memory storage, even if the transaction later returns an error
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to update this room
            if !self.check_entity_permission(tx, user_id, room_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update room '{}'",
                    user_id, room_id
                )));
            }

            // Update the room
            let name_option = name.map(|s| s.to_string());
            let desc_option = description.map(|s| s.to_string());
            let mdx_option = mdx_content.map(|s| s.to_string());
            room_ops::update_room_inner(tx, user_id, room_id, name_option, desc_option, mdx_option)
        })
    }

    /// Delete a room (internal implementation)
    pub(crate) fn delete_room_internal(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if the user has permission to delete this room
            if !self.check_entity_permission(tx, user_id, room_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete room '{}'",
                    user_id, room_id
                )));
            }

            // Delete the room
            room_ops::delete_room_inner(tx, user_id, room_id)
        })
    }

    /// List rooms, optionally filtering by office (internal implementation)
    pub(crate) fn list_rooms_internal(
        &self,
        user_id: &str,
        office_id_opt: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If office ID is specified, check permissions
            if let Some(office_id) = &office_id_opt {
                if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list rooms in office '{}'",
                        user_id, office_id
                    )));
                }
            }

            // List the rooms
            // Convert Option<&str> to Option<String> for the office_id
            let office_id_string = office_id_opt.map(|s| s.to_string());
            room_ops::list_rooms_inner(tx, user_id, office_id_string)
        })
    }
    
    /// List members of a specific room (internal implementation)
    pub(crate) fn list_room_members(&self, room_id: &str) -> Result<Vec<(String, String)>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            room_ops::list_room_members(tx, room_id)
        })
    }
}
