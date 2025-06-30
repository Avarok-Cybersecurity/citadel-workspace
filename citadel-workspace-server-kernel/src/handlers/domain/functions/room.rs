//! # Room Operations Module
//!
//! This module provides comprehensive room management functionality within office contexts.
//! It handles the complete lifecycle of room entities including creation, deletion, listing,
//! and updates with proper permission validation and hierarchical consistency.
//!
//! ## Key Features
//!
//! ### Room Lifecycle Management
//! - **Room Creation**: Create new rooms within offices with proper permission validation and domain setup
//! - **Room Deletion**: Safe deletion with cascading cleanup of office associations and domain entries
//! - **Room Updates**: Modify room properties including name, description, and MDX content
//! - **Room Queries**: List and retrieve rooms based on office membership and user permissions
//!
//! ### Hierarchical Integration
//! - **Office Association**: Maintain bidirectional relationships between rooms and parent offices
//! - **Domain Hierarchy**: Proper integration with the domain permission system
//! - **Permission Inheritance**: Leverage parent office permissions for room access control
//! - **Member Management**: Coordinate room membership with office-level access
//!
//! ### Security & Permissions
//! - **Permission Validation**: Comprehensive permission checking for all room operations
//! - **Membership Filtering**: Only show rooms where users have appropriate access
//! - **Ownership Protection**: Respect room ownership and administrative hierarchies
//! - **Cascading Security**: Maintain security consistency across office-room relationships
//!
//! ## Data Consistency
//! All operations maintain referential integrity between rooms, their parent offices, and the
//! domain permission system, ensuring proper hierarchical relationships and access control.

pub mod room_ops {
    use crate::handlers::domain::permission_denied;
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{error, info};
    use citadel_sdk::prelude::NetworkError;
    use citadel_workspace_types::structs::{Domain, Permission, Room, UserRole};

    // ════════════════════════════════════════════════════════════════════════════
    // ROOM LIFECYCLE OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Creates a new room within an office with comprehensive validation and setup.
    ///
    /// This function handles the complete room creation process including permission validation,
    /// office association, domain setup, and member initialization. It ensures proper
    /// hierarchical relationships and maintains data consistency across the domain system.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `user_id` - ID of the user creating the room (must have permission)
    /// * `office_id` - ID of the parent office where this room will be created
    /// * `room_id` - Pre-generated unique identifier for the new room
    /// * `name` - Display name for the room
    /// * `description` - Detailed description of the room's purpose
    /// * `mdx_content` - Optional MDX content for rich room documentation
    ///
    /// # Returns
    /// * `Ok(Room)` - Successfully created room with full configuration
    /// * `Err(NetworkError)` - Creation failed due to validation or permission errors
    ///
    /// # Permission Requirements
    /// - User must exist in the system
    /// - User must have `CreateRoom` permission for the target office
    /// - Office must exist and be a valid office domain
    ///
    /// # Side Effects
    /// - Creates room entity with initial member (creator)
    /// - Creates corresponding domain entry for permission hierarchy
    /// - Assigns Owner role to the creating user
    /// - Adds room ID to parent office's room list
    /// - Updates office domain to reflect the new room association
    #[allow(dead_code)]
    pub(crate) fn create_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str,   // User creating the room
        office_id: &str, // Office this room belongs to
        room_id: &str,   // Pre-generated room ID
        name: &str,
        description: &str,
        mdx_content: Option<String>,
    ) -> Result<Room, NetworkError> {
        // User Validation: Ensure the creating user exists
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        
        // Permission Validation: User must have CreateRoom permission in the target office
        if !user.has_permission(office_id, Permission::CreateRoom) {
            return Err(permission_denied(format!(
                "User {} cannot create room in office {}",
                user_id, office_id
            )));
        }

        // Office Validation: Ensure the office domain exists and is indeed an office
        let mut office_owned_domain = tx
            .get_domain(office_id)
            .ok_or_else(|| NetworkError::msg(format!("Office domain {} not found", office_id)))?
            .clone();

        let office_obj = office_owned_domain
            .as_office_mut()
            .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", office_id)))?;

        // Room Entity Creation: Create the new room with initial configuration
        let new_room = Room {
            id: room_id.to_string(),
            owner_id: user_id.to_string(),
            office_id: office_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()], // Creator is automatically the first member
            mdx_content: mdx_content.unwrap_or_default(),
            metadata: Vec::new(), // Initialize with empty metadata
        };

        // Domain Hierarchy: Create the domain entry for the room (parent_id is implicitly office_id)
        let room_domain = Domain::Room {
            room: new_room.clone(),
        };
        tx.insert_domain(room_id.to_string(), room_domain)?;

        // Permission Assignment: Add user to the new room's domain with Owner role
        tx.add_user_to_domain(user_id, room_id, UserRole::Owner)?;

        // Office Association: Add room_id to office's list of rooms
        let room_id_string = room_id.to_string();
        if !office_obj.rooms.contains(&room_id_string) {
            office_obj.rooms.push(room_id_string);
        }
        
        // Database Update: Update office domain to reflect the new room association
        tx.update_domain(office_id, office_owned_domain)?;

        info!(
            user_id = user_id,
            office_id = office_id,
            room_id = room_id,
            "Created room {:?}",
            new_room.name
        );
        Ok(new_room)
    }

    /// Deletes a room with comprehensive cleanup and office dissociation.
    ///
    /// This function safely removes a room from the system with proper permission validation
    /// and cascading cleanup. It removes the room from its parent office's room list and
    /// cleans up all associated domain entries while maintaining data consistency.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `user_id` - ID of the user performing the deletion (must have permission)
    /// * `room_id` - ID of the room to delete
    ///
    /// # Returns
    /// * `Ok(Room)` - Successfully deleted room entity for confirmation
    /// * `Err(NetworkError)` - Deletion failed due to permission or validation errors
    ///
    /// # Permission Requirements
    /// - User must exist in the system
    /// - User must have `DeleteRoom` permission for the target room
    /// - Room must exist and be a valid room domain
    ///
    /// # Side Effects
    /// - Removes room from parent office's room list
    /// - Removes room domain entry (cascading removal of all user associations)
    /// - Updates office domain to reflect room removal
    /// - Logs errors for any cleanup failures while continuing with deletion
    #[allow(dead_code)]
    pub(crate) fn delete_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str, // User performing the deletion
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        // User Validation: Ensure the deleting user exists
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        
        // Permission Validation: User must have DeleteRoom permission for the target room
        if !user.has_permission(room_id, Permission::DeleteRoom) {
            return Err(permission_denied(format!(
                "User {} cannot delete room {}",
                user_id, room_id
            )));
        }

        // Room Validation: Ensure room domain exists and extract office association
        let room_domain_clone = tx
            .get_domain(room_id)
            .ok_or_else(|| {
                NetworkError::msg(format!("Room domain {} not found for deletion", room_id))
            })?
            .clone();

        let parent_office_id_opt = match &room_domain_clone {
            Domain::Room { room, .. } => Some(room.office_id.clone()), // Extract office_id from room
            _ => {
                return Err(NetworkError::msg(format!(
                    "Domain {} is not a room, cannot be deleted as such",
                    room_id
                )))
            }
        };

        // Office Cleanup: Remove room from parent office's room list
        if let Some(ref parent_office_id_str) = parent_office_id_opt {
            if !parent_office_id_str.is_empty() {
                // Office Validation: Ensure parent office exists
                let mut office_owned_domain = tx
                    .get_domain(parent_office_id_str)
                    .ok_or_else(|| {
                        NetworkError::msg(format!(
                            "Parent office {} not found for room {}",
                            parent_office_id_str, room_id
                        ))
                    })?
                    .clone();

                // Office Update: Remove room from office's room list
                match &mut office_owned_domain {
                    Domain::Office { office, .. } => {
                        office.rooms.retain(|id| id != room_id);
                    }
                    _ => {
                        error!(
                            "Parent domain {} for room {} is not an Office",
                            parent_office_id_str, room_id
                        );
                        // Log error but continue with room deletion
                    }
                }
                
                // Database Update: Update office domain (with error handling for partial failures)
                if let Err(e) = tx.update_domain(parent_office_id_str, office_owned_domain) {
                    error!(error = ?e, parent_office_id = parent_office_id_str, room_id, "Failed to update parent office while deleting room. Manual cleanup may be required.");
                }
            }
        }

        // Domain Cleanup: Remove room domain entry (includes all user associations)
        let removed_domain = tx
            .remove_domain(room_id)?
            .ok_or_else(|| NetworkError::msg(format!("Room {} not found for deletion", room_id)))?;

        // Result Extraction: Extract room entity from removed domain for confirmation
        let removed_room = match removed_domain {
            Domain::Room { room, .. } => room,
            _ => {
                return Err(NetworkError::msg(format!(
                    "Deleted domain {} was not a room",
                    room_id
                )))
            }
        };

        info!(
            user_id = user_id,
            room_id = room_id,
            "Deleted room {:?}",
            removed_room.name
        );
        Ok(removed_room)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // ROOM QUERY AND LISTING OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Lists rooms accessible to a user with optional office filtering.
    ///
    /// This function retrieves rooms that a user has access to, either within a specific
    /// office or across all offices where the user has membership. It respects permission
    /// boundaries and only returns rooms where the user has appropriate access.
    ///
    /// # Arguments
    /// * `tx` - Read-only transaction for database operations
    /// * `user_id` - ID of the user requesting the room list
    /// * `office_id` - Optional office ID to filter rooms to a specific office
    ///
    /// # Returns
    /// * `Ok(Vec<Room>)` - List of accessible rooms (may be empty)
    /// * `Err(NetworkError)` - Listing failed due to permission or validation errors
    ///
    /// # Permission Requirements
    /// - User must exist in the system
    /// - If office_id provided: User must be a member of that office
    /// - If no office_id: User must have membership in rooms across all accessible offices
    ///
    /// # Behavior Modes
    /// - **Office-Specific**: Returns rooms within the specified office where user has access
    /// - **Cross-Office**: Returns all rooms across all offices where user has membership
    #[allow(dead_code)]
    pub(crate) fn list_rooms_inner(
        tx: &dyn Transaction,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        // User Validation: Ensure the requesting user exists
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        let mut rooms = Vec::new();

        if let Some(off_id) = office_id {
            // Office-Specific Mode: List rooms within a specific office
            
            // Permission Validation: User must be a member of the specified office
            if !tx.is_member_of_domain(&user.id, &off_id)? {
                return Err(permission_denied(format!(
                    "User {} is not a member of office {}",
                    user_id, off_id
                )));
            }

            // Office Validation: Ensure office domain exists and is valid
            let office_domain = tx
                .get_domain(&off_id)
                .ok_or_else(|| NetworkError::msg(format!("Office domain {} not found", off_id)))?;

            let office = office_domain
                .as_office()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", off_id)))?;

            // Room Filtering: Check each room in the office for user membership
            for r_id in &office.rooms {
                if tx.is_member_of_domain(&user.id, r_id).unwrap_or(false) {
                    if let Some(domain_obj) = tx.get_domain(r_id) {
                        if let Some(room) = domain_obj.as_room() {
                            rooms.push(room.clone());
                        }
                    }
                }
            }
        } else {
            // Cross-Office Mode: List all rooms the user is a member of across all offices
            
            // Permission Scanning: Check all domains where user has permissions
            for domain_id_key in user.permissions.keys() {
                if let Some(Domain::Room { room, .. }) = tx.get_domain(domain_id_key) {
                    // Membership Validation: Verify user is actually a member of this room
                    if tx.is_member_of_domain(&user.id, &room.id).unwrap_or(false) {
                        rooms.push(room.clone());
                    }
                }
            }
        }
        
        info!(user_id = user_id, count = rooms.len(), "Listed rooms");
        Ok(rooms)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // ROOM UPDATE OPERATIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Updates room properties with validation and permission checking.
    ///
    /// This function allows modification of room properties including name, description,
    /// and MDX content. It validates permissions and maintains data consistency while
    /// providing flexible partial updates through optional parameters.
    ///
    /// # Arguments
    /// * `tx` - Mutable transaction for database operations
    /// * `user_id` - ID of the user performing the update (must have permission)
    /// * `room_id` - ID of the room to update
    /// * `name` - Optional new name for the room
    /// * `description` - Optional new description for the room
    /// * `mdx_content` - Optional new MDX content for the room
    ///
    /// # Returns
    /// * `Ok(Room)` - Successfully updated room with new properties
    /// * `Err(NetworkError)` - Update failed due to permission or validation errors
    ///
    /// # Permission Requirements
    /// - User must exist in the system
    /// - User must have `UpdateRoom` permission for the target room
    /// - Room must exist and be a valid room domain
    ///
    /// # Update Behavior
    /// - Only provided (Some) values are updated; None values leave properties unchanged
    /// - Updates are applied atomically; either all succeed or none are applied
    /// - Domain entry is updated to maintain consistency across the system
    #[allow(dead_code)]
    pub(crate) fn update_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        room_id: &str,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
    ) -> Result<Room, NetworkError> {
        // User Validation: Ensure the updating user exists
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        
        // Permission Validation: User must have UpdateRoom permission for the target room
        if !user.has_permission(room_id, Permission::UpdateRoom) {
            return Err(permission_denied(format!(
                "User {} cannot update room {}",
                user_id, room_id
            )));
        }

        // Room Validation: Ensure room domain exists and is valid
        let mut owned_domain = tx
            .get_domain(room_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain for room {} not found", room_id)))?
            .clone();

        let room_to_update = match &mut owned_domain {
            Domain::Room { room, .. } => room,
            _ => {
                return Err(NetworkError::msg(format!(
                    "Domain {} is not a room",
                    room_id
                )))
            }
        };

        // Property Updates: Apply only the provided (Some) updates
        if let Some(n) = name {
            room_to_update.name = n;
        }
        if let Some(d) = description {
            room_to_update.description = d;
        }
        if let Some(mdx) = mdx_content {
            room_to_update.mdx_content = mdx;
        }

        // Result Preparation: Clone updated room for return value
        let updated_room_clone = room_to_update.clone();
        
        // Database Update: Apply changes to domain entry
        tx.update_domain(room_id, owned_domain)?;

        info!(
            user_id = user_id,
            room_id = room_id,
            "Updated room {:?}",
            updated_room_clone.name
        );
        Ok(updated_room_clone)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // FUTURE EXTENSIONS
    // ════════════════════════════════════════════════════════════════════════════

    // TODO: Implement room-specific settings management functionality
    // This would include features like:
    // - Room-specific access policies and permissions
    // - Room notification and announcement settings  
    // - Room-level integrations and custom features
    // - Advanced room metadata and configuration options
}
