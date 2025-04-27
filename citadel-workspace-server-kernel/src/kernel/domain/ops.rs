use crate::handlers::domain::{DomainEntity, DomainOperations};
use crate::handlers::transaction::Transaction;
use crate::kernel::WorkspaceServerKernel;
use citadel_logging::{debug, info};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for WorkspaceServerKernel<R> {
    fn init(&self) -> Result<(), NetworkError> {
        // Initialize any required resources
        Ok(())
    }

    fn kernel(&self) -> &WorkspaceServerKernel<R> {
        self
    }

    fn is_admin(&self, user_id: &str) -> bool {
        self.is_admin(user_id)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        self.with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        self.transaction_manager.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        info!(target: "citadel", "Checking permission {:?} for user {} on entity {}", permission, user_id, entity_id);

        // Check if user is admin - admins have all permissions
        if self.is_admin(user_id) {
            info!(target: "citadel", "User {} is admin, permission {:?} granted for entity {}", user_id, permission, entity_id);
            return Ok(true);
        }

        // Get the user
        let user = match self.get_user(user_id) {
            Some(user) => user,
            None => return Err(NetworkError::msg("User not found")),
        };

        // Check if user has the permission for this entity
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(entity_id) {
                match domain {
                    Domain::Office { ref office } => {
                        // Office owners have all permissions for their office
                        if office.owner_id == user_id {
                            return Ok(true);
                        }

                        // Office members may have some permissions based on role
                        if office.members.contains(&user_id.to_string()) {
                            match user.role {
                                UserRole::Admin => Ok(true), // Admins have all permissions
                                UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                                UserRole::Member => {
                                    match permission {
                                        Permission::ViewContent => Ok(true), // Members can view content
                                        _ => Ok(false),
                                    }
                                }
                                _ => Ok(false),
                            }
                        } else {
                            Ok(false)
                        }
                    }
                    Domain::Room { ref room } => {
                        // Room owners have all permissions for their room
                        if room.owner_id == user_id {
                            return Ok(true);
                        }

                        // Room members may have some permissions based on role
                        if room.members.contains(&user_id.to_string()) {
                            match user.role {
                                UserRole::Admin => Ok(true), // Admins have all permissions
                                UserRole::Owner => Ok(true), // Owners have all permissions for entities they belong to
                                UserRole::Member => {
                                    match permission {
                                        Permission::ViewContent => Ok(true),  // Members can view content
                                        Permission::SendMessages => Ok(true), // Members can send messages
                                        Permission::ReadMessages => Ok(true), // Members can read messages
                                        _ => Ok(false),
                                    }
                                }
                                _ => Ok(false),
                            }
                        } else {
                            Ok(false)
                        }
                    }
                    Domain::Workspace { .. } => Ok(false),
                }
            } else {
                Err(NetworkError::msg("Entity not found"))
            }
        })
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.with_read_transaction(|tx| tx.is_member_of_domain(user_id, domain_id))
    }

    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Delegate to the centralized check_entity_permission for consistency
        self.check_entity_permission(user_id, entity_id, permission)
    }

    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError> {
        // Check if user is an admin
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user is member of the room
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(room_id) {
                match domain {
                    Domain::Room { room } => {
                        // First check if user is directly a member of the room
                        if room.owner_id == user_id || room.members.contains(&user_id.to_string()) {
                            return Ok(true);
                        }

                        // Check parent office to implement permission inheritance
                        if let Some(Domain::Office { office }) = tx.get_domain(&room.office_id) {
                            // Check if user is a member of the parent office
                            return Ok(office.owner_id == user_id
                                || office.members.contains(&user_id.to_string()));
                        }

                        Ok(false)
                    }
                    _ => Err(NetworkError::msg("Not a room")),
                }
            } else {
                Err(NetworkError::msg("Room not found"))
            }
        })
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        // Need to handle the Result -> Option conversion
        self.with_read_transaction(|tx| Ok(tx.get_domain(domain_id).cloned()))
            .unwrap_or(None)
    }

    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| tx.add_user_to_domain(user_id, domain_id, role))
    }

    fn remove_user_from_domain(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| tx.remove_user_from_domain(user_id, domain_id))
    }

    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Check permission first
        let read_permission = Permission::ReadMessages;
        if !self.check_entity_permission(user_id, entity_id, read_permission)? {
            return Err(NetworkError::msg("No permission to get this entity"));
        }

        // Get the domain
        if let Some(domain) = self.get_domain(entity_id) {
            // Convert domain to the requested entity type
            if let Some(entity) = T::from_domain(domain) {
                Ok(entity)
            } else {
                Err(NetworkError::msg(
                    "Domain is not of the requested entity type",
                ))
            }
        } else {
            Err(NetworkError::msg("Entity not found"))
        }
    }

    fn create_domain_entity<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        // Check if the user has permission to create an entity
        if !self.is_admin(user_id) {
            // Only admin users can create top-level entities (offices)
            if parent_id.is_none() && std::any::type_name::<T>().contains("Office") {
                return Err(NetworkError::msg("Only admin users can create offices"));
            }

            // For rooms, check if the user has permission to add a room to the office
            if let Some(office_id) = parent_id {
                if !self.check_entity_permission(user_id, office_id, Permission::AddRoom)? {
                    return Err(NetworkError::msg(
                        "User does not have permission to create a room in this office",
                    ));
                }
            }
        }

        // Create a unique ID
        let id = uuid::Uuid::new_v4().to_string();

        // Initialize the entity with basic properties
        let entity = T::create(
            id.clone(),
            parent_id.map(|s| s.to_string()),
            name,
            description,
        );

        // Create domain enum for the entity
        let domain = entity.clone().into_domain();

        // Add the user as a member
        let mut domain_with_user = domain.clone();
        match &mut domain_with_user {
            Domain::Office { ref mut office } => {
                if !office.members.contains(&user_id.to_string()) {
                    office.members.push(user_id.to_string());
                }
                // Add mdx_content if provided
                if let Some(mdx) = mdx_content {
                    office.mdx_content = mdx.to_string();
                }
            }
            Domain::Room { ref mut room } => {
                if !room.members.contains(&user_id.to_string()) {
                    room.members.push(user_id.to_string());
                }
                // Add mdx_content if provided
                if let Some(mdx) = mdx_content {
                    room.mdx_content = mdx.to_string();
                }
            }
            Domain::Workspace { ref mut workspace } => {
                if !workspace.members.contains(&user_id.to_string()) {
                    workspace.members.push(user_id.to_string());
                }
                // Store mdx_content in the metadata field
                let content_bytes = match mdx_content {
                    Some(content) => content.as_bytes().to_vec(),
                    None => Vec::new(),
                };
                workspace.metadata = content_bytes;
            }
        }

        // Insert the domain entity
        self.with_write_transaction(|tx| {
            tx.insert_domain(id, domain_with_user.clone())?;
            let entity = T::from_domain(domain_with_user)
                .ok_or_else(|| NetworkError::msg("Failed to create domain entity"))?;
            Ok(entity)
        })
    }

    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Get entity before deleting it
        let entity = self.get_domain_entity::<T>(user_id, entity_id)?;

        // Check if user has permission to delete this entity
        let delete_permission = match std::any::type_name::<T>() {
            "Office" => Permission::DeleteOffice,
            "Room" => Permission::DeleteRoom,
            _ => Permission::All,
        };

        if !self.check_entity_permission(user_id, entity_id, delete_permission)? {
            info!(target: "citadel", "User {} denied permission to delete entity {}", user_id, entity_id);
            return Err(NetworkError::msg("No permission to delete this entity"));
        }

        info!(target: "citadel", "User {} deleting entity {}", user_id, entity_id);
        debug!(target: "citadel", "Audit log: User {} deleted entity {}", user_id, entity_id);

        // Remove the entity
        self.with_write_transaction(|tx| {
            tx.remove_domain(entity_id)?;
            Ok(entity)
        })
    }

    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        // Check if user has permission to update this entity
        let update_permission = match std::any::type_name::<T>() {
            "Office" => Permission::UpdateOfficeSettings,
            "Room" => Permission::UpdateRoomSettings,
            _ => Permission::All,
        };

        if !self.check_entity_permission(user_id, entity_id, update_permission)? {
            info!(target: "citadel", "User {} denied permission to update entity {}", user_id, entity_id);
            return Err(NetworkError::msg("No permission to update this entity"));
        }

        info!(target: "citadel", "User {} updating entity {}", user_id, entity_id);

        // Update the entity
        self.with_write_transaction(|tx| {
            if let Some(mut domain) = tx.get_domain(entity_id).cloned() {
                // Update domain properties
                if let Some(name) = name {
                    info!(target: "citadel", "User {} changing name of entity {} to '{}'", user_id, entity_id, name);
                    domain.update_name(name.to_string());
                }
                if let Some(description) = description {
                    info!(target: "citadel", "User {} updating description of entity {}", user_id, entity_id);
                    domain.update_description(description.to_string());
                }
                if let Some(mdx_content) = mdx_content {
                    info!(target: "citadel", "User {} updating mdx_content of entity {}", user_id, entity_id);
                    match &mut domain {
                        Domain::Office { ref mut office } => {
                            office.mdx_content = mdx_content.to_string();
                        }
                        Domain::Room { ref mut room } => {
                            room.mdx_content = mdx_content.to_string();
                        }
                        Domain::Workspace { ref mut workspace } => {
                            // Store mdx_content in the metadata field
                            let content_bytes = mdx_content.as_bytes().to_vec();
                            workspace.metadata = content_bytes;
                        }
                    }
                }

                // Save the updated domain
                let domain_clone = domain.clone();
                tx.update_domain(entity_id, domain)?;
                let updated_domain = T::from_domain(domain_clone)
                    .ok_or_else(|| NetworkError::msg("Failed to convert domain"))?;
                debug!(target: "citadel", "Audit log: User {} completed update of entity {}", user_id, entity_id);
                Ok(updated_domain)
            } else {
                Err(NetworkError::msg("Entity not found"))
            }
        })
    }

    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        // Check if user is admin or has appropriate permissions
        if !self.is_admin(user_id) {
            if let Some(_parent_id) = parent_id {
                // Check if user has access to the parent domain
                if !self.is_member_of_domain(user_id, _parent_id)? {
                    return Err(NetworkError::msg(
                        "No permission to list entities in this parent",
                    ));
                }
            }
        }

        // List entities
        self.with_read_transaction(|tx| {
            let mut entities = Vec::new();

            for (_, domain) in tx.get_domains().iter() {
                // Check if domain has the expected parent
                let domain_parent_matches = match domain {
                    Domain::Office { office } => {
                        // For Office entities, the domain_id is always the fixed workspace root ID
                        let is_match = parent_id.as_ref().map_or(false, |pid| crate::WORKSPACE_ROOT_ID == *pid);
                        if is_match {
                            debug!(target: "citadel", "Office {} belongs to workspace-root", office.id);
                        }
                        is_match
                    }
                    Domain::Room { room } => {
                        // For rooms, the parent could be our target office
                        let is_match = parent_id.as_ref().map_or(false, |pid| room.office_id == *pid);
                        if is_match {
                            debug!(target: "citadel", "Room {} matches target office ID {:?}", room.id, parent_id);
                        }
                        is_match
                    },
                    Domain::Workspace { workspace } => {
                        // Workspaces have no parent but might be a parent of the target office
                        let parent_id_str = parent_id.as_ref().map_or("", |s| s);
                        let is_match = workspace.id == parent_id_str || workspace.offices.iter().any(|office_id| office_id == parent_id_str);
                        if is_match {
                            debug!(target: "citadel", "Workspace {} matches target ID {}", workspace.id, parent_id_str);
                        }
                        is_match
                    }
                };

                if domain_parent_matches {
                    if let Some(entity) = T::from_domain(domain.clone()) {
                        entities.push(entity);
                    }
                }
            }

            Ok(entities)
        })
    }

    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        // Delegate to the ServerDomainOps implementation
        self.domain_ops()
            .list_offices_in_workspace(user_id, workspace_id)
    }

    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Use the generic method with Office type
        self.create_domain_entity::<Office>(user_id, None, name, description, mdx_content)
    }

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Use the generic method with Room type
        self.create_domain_entity::<Room>(user_id, Some(office_id), name, description, mdx_content)
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Use the generic method with Office type
        self.get_domain_entity::<Office>(user_id, office_id)
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Use the generic method with Room type
        self.get_domain_entity::<Room>(user_id, room_id)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        let _office = self.get_office(user_id, office_id)?;
        self.delete_domain_entity::<Office>(user_id, office_id)
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        let _room = self.get_room(user_id, room_id)?;
        self.delete_domain_entity::<Room>(user_id, room_id)
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Get the office before updating to check if it exists
        let _office = self.get_office(user_id, office_id)?;

        // Update the office
        self.update_domain_entity::<Office>(user_id, office_id, name, description, mdx_content)
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Get the room before updating to check if it exists
        let _room = self.get_room(user_id, room_id)?;

        // Update the room
        self.update_domain_entity::<Room>(user_id, room_id, name, description, mdx_content)
    }

    fn list_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        // Use the generic method with Office type
        self.list_domain_entities::<Office>(user_id, None)
    }

    fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Use the generic method with Room type
        self.list_domain_entities::<Room>(user_id, Some(office_id))
    }

    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.get_workspace(user_id, workspace_id)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.create_workspace(user_id, name, description, metadata)
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.delete_workspace(user_id, workspace_id)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.update_workspace(user_id, workspace_id, name, description, metadata)
    }

    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.add_office_to_workspace(user_id, workspace_id, office_id)
    }

    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.remove_office_from_workspace(user_id, workspace_id, office_id)
    }

    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.add_user_to_workspace(user_id, workspace_id, member_id)
    }

    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        let domain_ops = self.domain_ops();
        domain_ops.remove_user_from_workspace(user_id, workspace_id, member_id)
    }

    /// Load the workspace for a user
    /// Since there's only one workspace in the system, this will retrieve that workspace
    /// if the user has access to it
    fn load_workspace(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        let domain_ops = self.domain_ops();
        // Use the fixed workspace ID to retrieve the single workspace
        domain_ops.get_workspace(user_id, crate::WORKSPACE_ROOT_ID)
    }

    /// List all workspaces (should only be one in the system)
    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        let domain_ops = self.domain_ops();
        // Get the single workspace and return it as a list with one item
        match domain_ops.get_workspace(user_id, "") {
            Ok(workspace) => Ok(vec![workspace]),
            Err(_) => Ok(Vec::new()), // Return empty list if no workspace exists
        }
    }
}
