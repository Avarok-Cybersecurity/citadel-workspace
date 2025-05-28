pub mod room_ops {
    use crate::handlers::domain::permission_denied;
    use crate::kernel::transaction::Transaction;
    use citadel_logging::{error, info};
    use citadel_sdk::prelude::NetworkError;
    use citadel_workspace_types::structs::{Domain, Permission, Room, UserRole};

    pub(crate) fn create_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str,   // User creating the room
        office_id: &str, // Office this room belongs to
        room_id: &str,   // Pre-generated room ID
        name: &str,
        description: &str,
        mdx_content: Option<String>,
    ) -> Result<Room, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        // Check if user has permission to create rooms in this office
        if !user.has_permission(office_id, Permission::CreateRoom) {
            return Err(permission_denied(format!(
                "User {} cannot create room in office {}",
                user_id, office_id
            )));
        }

        // Ensure the office domain exists and is indeed an office
        let mut office_owned_domain = tx
            .get_domain(office_id)
            .ok_or_else(|| NetworkError::msg(format!("Office domain {} not found", office_id)))?
            .clone();

        let office_obj = office_owned_domain
            .as_office_mut()
            .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", office_id)))?;

        // Create the new room struct
        let new_room = Room {
            id: room_id.to_string(),
            owner_id: user_id.to_string(),
            office_id: office_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            members: vec![user_id.to_string()], // Creator is the first member
            mdx_content: mdx_content.unwrap_or_default(),
            metadata: Vec::new(),               // Default empty metadata
        };

        // Create the domain entry for the room
        // The parent_id for a Room domain is implicitly its office_id, handled by Domain::parent_id()
        let room_domain = Domain::Room {
            room: new_room.clone(),
        };
        tx.insert_domain(room_id.to_string(), room_domain)?; // Corrected: use insert_domain and ensure room_id is String

        // Add user to the new room's domain with Owner role
        tx.add_user_to_domain(user_id, room_id, UserRole::Owner)?;

        // Add room_id to office's list of rooms
        let room_id_string = room_id.to_string();
        if !office_obj.rooms.contains(&room_id_string) {
            office_obj.rooms.push(room_id_string);
        }
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

    pub(crate) fn delete_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str, // User performing the deletion
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        if !user.has_permission(room_id, Permission::DeleteRoom) {
            return Err(permission_denied(format!(
                "User {} cannot delete room {}",
                user_id, room_id
            )));
        }

        let room_domain_clone = tx
            .get_domain(room_id)
            .ok_or_else(|| {
                NetworkError::msg(format!("Room domain {} not found for deletion", room_id))
            })?
            .clone();

        let parent_office_id_opt = match &room_domain_clone {
            Domain::Room { room, .. } => Some(room.office_id.clone()), // Get office_id from the room struct
            _ => {
                return Err(NetworkError::msg(format!(
                    "Domain {} is not a room, cannot be deleted as such",
                    room_id
                )))
            }
        };

        // 1. Remove room from parent office's list
        if let Some(ref parent_office_id_str) = parent_office_id_opt {
            // Corrected: use ref to get &String
            if !parent_office_id_str.is_empty() {
                // Ensure parent_office_id is not empty
                let mut office_owned_domain = tx
                    .get_domain(parent_office_id_str)
                    .ok_or_else(|| {
                        NetworkError::msg(format!(
                            "Parent office {} not found for room {}",
                            parent_office_id_str, room_id
                        ))
                    })?
                    .clone();

                match &mut office_owned_domain {
                    Domain::Office { office, .. } => {
                        office.rooms.retain(|id| id != room_id); // Corrected: office.rooms
                    }
                    _ => {
                        error!(
                            "Parent domain {} for room {} is not an Office",
                            parent_office_id_str, room_id
                        );
                        // Log error and continue with room deletion
                    }
                }
                if let Err(e) = tx.update_domain(parent_office_id_str, office_owned_domain) {
                    error!(error = ?e, parent_office_id = parent_office_id_str, room_id, "Failed to update parent office while deleting room. Manual cleanup may be required.");
                }
            }
        }

        // 2. Remove all users from this room's domain entries
        let removed_domain = tx
            .remove_domain(room_id)?
            .ok_or_else(|| NetworkError::msg(format!("Room {} not found for deletion", room_id)))?;

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

    pub(crate) fn list_rooms_inner(
        tx: &dyn Transaction,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        let mut rooms = Vec::new();

        if let Some(off_id) = office_id {
            if !tx.is_member_of_domain(&user.id, &off_id)? {
                return Err(permission_denied(format!(
                    "User {} is not a member of office {}",
                    user_id, off_id
                )));
            }

            let office_domain = tx
                .get_domain(&off_id)
                .ok_or_else(|| NetworkError::msg(format!("Office domain {} not found", off_id)))?;

            let office = office_domain
                .as_office() // Corrected: use as_office()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} is not an office", off_id)))?;

            for r_id in &office.rooms {
                // Corrected: office.rooms
                if tx.is_member_of_domain(&user.id, r_id).unwrap_or(false) {
                    if let Some(domain) = tx.get_domain(r_id) {
                        if let Some(room) = domain.as_room() {
                            // Corrected: use as_room()
                            rooms.push(room.clone());
                        }
                    }
                }
            }
        } else {
            // List all rooms the user is a member of, across all offices they can see
            for domain_id_key in user.permissions.keys() {
                if let Some(domain) = tx.get_domain(domain_id_key) {
                    if let Domain::Room { room, .. } = domain {
                        if tx.is_member_of_domain(&user.id, &room.id).unwrap_or(false) {
                            rooms.push(room.clone());
                        }
                    }
                }
            }
        }
        info!(user_id = user_id, count = rooms.len(), "Listed rooms");
        Ok(rooms)
    }

    pub(crate) fn update_room_inner(
        tx: &mut dyn Transaction,
        user_id: &str,
        room_id: &str,
        name: Option<String>,
        description: Option<String>,
        mdx_content: Option<String>,
    ) -> Result<Room, NetworkError> {
        let user = tx
            .get_user(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User {} not found", user_id)))?;
        // Permission check: User needs UpdateRoom permission on the room itself
        if !user.has_permission(room_id, Permission::UpdateRoom) {
            return Err(permission_denied(format!(
                "User {} cannot update room {}",
                user_id, room_id
            )));
        }

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

        if let Some(n) = name {
            room_to_update.name = n;
        }
        if let Some(d) = description {
            room_to_update.description = d;
        }
        if let Some(mdx) = mdx_content {
            room_to_update.mdx_content = mdx;
        }

        let updated_room_clone = room_to_update.clone();
        tx.update_domain(room_id, owned_domain)?;

        info!(
            user_id = user_id,
            room_id = room_id,
            "Updated room {:?}",
            updated_room_clone.name
        );
        Ok(updated_room_clone)
    }

    // TODO: Implement functions for managing room-specific settings or features if any
}
