use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, Permission, Room};
use uuid::Uuid;
use crate::handlers::domain::{permission_denied, DomainOperations};
use crate::handlers::domain::server_ops::ServerDomainOps;
use crate::kernel::transaction::Transaction;

impl<R: Ratchet> ServerDomainOps<R> {
    pub fn remove_user_from_workspace_inner(&self, user_id: &str, member_id: &str) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspace
        if !self.check_entity_permission(user_id, &workspace_id, Permission::RemoveUsers)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot remove users from workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Check if trying to remove the workspace owner
            if workspace.owner_id == member_id {
                return Err(NetworkError::msg("Cannot remove workspace owner"));
            }

            // Remove member from workspace
            workspace.members.retain(|id| id != member_id);

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
    }

    pub fn add_user_to_workspace_inner(&self, user_id: &str, member_id: &&str) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspace
        if !self.check_entity_permission(user_id, &workspace_id, Permission::AddUsers)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot add users to workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Check if member is already in workspace
            if workspace.members.contains(&member_id.to_string()) {
                return Ok(()); // Member already in workspace
            }

            // Add member to workspace
            workspace.members.push(member_id.to_string());

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
    }

    pub fn list_rooms_inner(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // List rooms in this office
        DomainOperations::list_domain_entities::<Room>(self, user_id, Some(office_id))
    }

    pub fn get_room_inner(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Check if user can access this room
        if !self.can_access_domain(user_id, room_id)? {
            return Err(permission_denied(
                "User does not have permission to access this room",
            ));
        }

        // Get the room entity
        DomainOperations::get_domain_entity::<Room>(self, user_id, room_id)
    }
    
    pub fn create_room_inner(&self, user_id: &str, office_id: &str, name: &str, description: &str, mdx_content: Option<&str>) -> Result<Room, NetworkError> {
        // Check if user has permission to create a room in this office
        if !self.check_entity_permission(user_id, office_id, Permission::CreateRoom)? {
            return Err(permission_denied(
                "You don't have permission to create rooms in this office",
            ));
        }

        self.with_write_transaction(|tx| {
            // Generate a unique ID for the new room
            let room_id = Uuid::new_v4().to_string();

            // Create the room
            let room = Room {
                id: room_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                office_id: office_id.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Owner is automatically a member
                mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                metadata: Vec::new(),
            };

            // Add it to the database
            tx.insert_domain(room_id, Domain::Room { room: room.clone() })?;
            Ok(room)
        })
    }
}