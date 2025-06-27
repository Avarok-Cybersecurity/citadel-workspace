use crate::handlers::domain::DomainOperations;
use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainEntity;
use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, User, UserRole, Permission, UpdateOperation, Room, Office, Workspace, WorkspaceDBList};

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for DomainServerOperations<R> {
    fn init(&self) -> Result<(), NetworkError> {
        Ok(())
    }

    fn is_admin(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError> {
        let _user = tx.get_user(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User '{}' not found in is_admin", user_id))
        })?;
        Ok(_user.role == UserRole::Admin)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        tx: &dyn Transaction,
        actor_user_id: &str,
        entity_id: &str,
        permission: super::Permission,
    ) -> Result<bool, NetworkError> {
        let actor = tx.get_user(actor_user_id).ok_or_else(|| {
            NetworkError::msg(format!(
                "User '{}' not found in check_entity_permission",
                actor_user_id
            ))
        })?;

        // Admin has all permissions
        if actor.role == UserRole::Admin {
            return Ok(true);
        }

        // Check if user has explicit permission for this entity
        // First check if user exists
        if tx.get_user(actor_user_id).is_none() {
            return Ok(false);
        }
        
        // Then check if the domain exists
        if tx.get_domain(entity_id).is_none() {
            return Ok(false);
        }
        
        // Check user's permissions for this domain
        let user_permissions = tx.get_permissions(actor_user_id)?
            .into_iter()
            .filter(|p| p == &permission)
            .collect::<Vec<_>>();
            
        // If user has the specific permission, return true
        if !user_permissions.is_empty() {
            return Ok(true);
        }
        
        // Otherwise check if user is an admin
        if let Some(user) = tx.get_user(actor_user_id) {
            if user.role == super::UserRole::Admin {
                return Ok(true);
            }
        }

        // User doesn't have direct permissions for this entity
        Ok(false)
    }

    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        // Simply delegate to check_entity_permission with no specific permission required
        self.check_entity_permission(tx, user_id, domain_id, super::Permission::All)
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_domain(domain_id).cloned()))
            .unwrap_or(None)
    }

    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission to add users
            if !self.check_entity_permission(tx, admin_id, domain_id, super::Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to domain '{}'",
                    admin_id, domain_id
                )));
            }

            // Check if user to add exists
            if tx.get_user(user_id_to_add).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not exist",
                    user_id_to_add
                )));
            }

            // Add user to domain with specified role
            tx.add_user_to_domain(user_id_to_add, domain_id, role)?;
            Ok(())
        })
    }

    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission
            if !self.check_entity_permission(tx, admin_id, domain_id, super::Permission::RemoveUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from domain '{}'",
                    admin_id, domain_id
                )));
            }

            // Check if user exists in domain
            if !self.is_member_of_domain(tx, user_id_to_remove, domain_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' is not a member of domain '{}'",
                    user_id_to_remove, domain_id
                )));
            }

            // Remove user from domain
            tx.remove_user_from_domain(user_id_to_remove, domain_id)?;
            Ok(())
        })
    }

    // Generic domain entity operations: these functions serve as the base for specialized entity operations
    fn get_domain_entity<T: DomainEntity + 'static>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user has permission to access this entity
            if !self.check_entity_permission(tx, user_id, entity_id, super::Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access {}",
                    user_id, entity_id
                )));
            }

            // Get the entity
            // Using get_domain for domain entities
            let domain = tx.get_domain(entity_id).ok_or_else(|| {
                NetworkError::msg(format!("Entity '{}' not found", entity_id))
            })?;
            
            // Convert domain to the requested type
            let entity = T::from_domain(domain.clone()).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Entity '{}' is not of type {}",
                    entity_id,
                    std::any::type_name::<T>()
                ))
            })?;

            Ok(entity.clone())
        })
    }
    
    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // If parent_id is provided, check if parent exists and user has permission to create entities in it
            if let Some(parent) = parent_id {
                if !self.check_entity_permission(tx, user_id, parent, super::Permission::CreateRoom)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to create entities in '{}'",
                        user_id, parent
                    )));
                }
            }
            
            // Generate a unique ID for the new entity
            let id = uuid::Uuid::new_v4().to_string();
            
            // Create the entity
            let entity = T::create(id.clone(), parent_id.map(|p| p.to_string()), name, description);
            
            // Convert to Domain and add to storage
            let domain = entity.clone().into_domain();
            
            // Update domain with MDX content if provided
            let domain = match (domain, mdx_content) {
                (Domain::Workspace { mut workspace }, Some(content)) => {
                    Domain::Workspace { workspace }
                },
                (Domain::Office { mut office }, Some(content)) => {
                    office.mdx_content = content.to_string();
                    Domain::Office { office }
                },
                (Domain::Room { mut room }, Some(content)) => {
                    room.mdx_content = content.to_string();
                    Domain::Room { room }
                },
                (domain, _) => domain,
            };
            
            // Add domain to storage
            tx.insert_domain(id.clone(), domain.clone())?;
            
            // Convert back to the requested type and return
            let entity = T::from_domain(domain).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Failed to convert domain back to type {}",
                    std::any::type_name::<T>()
                ))
            })?;
            
            Ok(entity)
        })
    }
    
    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to delete this entity
            let permission = match tx.get_domain(entity_id) {
                Some(Domain::Workspace { .. }) => super::Permission::DeleteWorkspace,
                Some(Domain::Office { .. }) => super::Permission::DeleteOffice,
                Some(Domain::Room { .. }) => super::Permission::DeleteRoom,
                None => return Err(NetworkError::msg(format!("Entity '{}' not found", entity_id))),
            };
            
            if !self.check_entity_permission(tx, user_id, entity_id, permission)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete {}",
                    user_id, entity_id
                )));
            }
            
            // Get the entity before deleting
            let domain = tx.get_domain(entity_id).ok_or_else(|| {
                NetworkError::msg(format!("Entity '{}' not found", entity_id))
            })?;
            
            // Convert domain to the requested type
            let entity = T::from_domain(domain.clone()).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Entity '{}' is not of type {}",
                    entity_id,
                    std::any::type_name::<T>()
                ))
            })?;
            
            // Remove the entity
            tx.remove_domain(entity_id)?;
            
            Ok(entity)
        })
    }
    
    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to update this entity
            let permission = match tx.get_domain(domain_id) {
                Some(Domain::Workspace { .. }) => super::Permission::UpdateWorkspace,
                Some(Domain::Office { .. }) => super::Permission::UpdateOffice,
                Some(Domain::Room { .. }) => super::Permission::UpdateRoom,
                None => return Err(NetworkError::msg(format!("Entity '{}' not found", domain_id))),
            };
            
            if !self.check_entity_permission(tx, user_id, domain_id, permission)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update {}",
                    user_id, domain_id
                )));
            }
            
            // Get the entity
            let domain = tx.get_domain(domain_id).ok_or_else(|| {
                NetworkError::msg(format!("Entity '{}' not found", domain_id))
            })?;
            
            // Update the domain with provided values
            let updated_domain = match domain {
                Domain::Workspace { mut workspace } => {
                    if let Some(n) = name { workspace.name = n.to_string(); }
                    if let Some(d) = description { workspace.description = d.to_string(); }
                    Domain::Workspace { workspace }
                },
                Domain::Office { mut office } => {
                    if let Some(n) = name { office.name = n.to_string(); }
                    if let Some(d) = description { office.description = d.to_string(); }
                    if let Some(m) = mdx_content { office.mdx_content = m.to_string(); }
                    Domain::Office { office }
                },
                Domain::Room { mut room } => {
                    if let Some(n) = name { room.name = n.to_string(); }
                    if let Some(d) = description { room.description = d.to_string(); }
                    if let Some(m) = mdx_content { room.mdx_content = m.to_string(); }
                    Domain::Room { room }
                },
            };
            
            // Update domain in storage
            tx.update_domain(domain_id.to_string(), updated_domain.clone())?;
            
            // Convert back to the requested type
            let entity = T::from_domain(updated_domain).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Failed to convert domain back to type {}",
                    std::any::type_name::<T>()
                ))
            })?;
            
            Ok(entity)
        })
    }
    
    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If parent_id is provided, check if user has permission to list entities in it
            if let Some(parent) = parent_id {
                if !self.check_entity_permission(tx, user_id, parent, super::Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list entities in '{}'",
                        user_id, parent
                    )));
                }
            }
            
            // Get all domains
            let domains = tx.get_all_domains()?;
            
            // Filter domains based on parent_id
            let filtered_domains = domains.into_iter().filter(|(_, domain)| {
                match (domain, parent_id) {
                    (Domain::Workspace { .. }, None) => true,
                    (Domain::Office { office }, Some(parent)) => office.workspace_id == parent,
                    (Domain::Room { room }, Some(parent)) => room.office_id == parent,
                    _ => false,
                }
            });
            
            // Convert each domain to the requested type and collect
            let mut entities = Vec::new();
            for (_id, domain) in filtered_domains {
                if let Some(entity) = T::from_domain(domain.clone()) {
                    entities.push(entity);
                }
            }
            
            Ok(entities)
        })
    }
    
    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission to add users
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Check if user exists
            let user = tx.get_user(member_id).ok_or_else(|| {
                NetworkError::msg(format!("User '{}' not found", member_id))
            })?;
            
            // Check if workspace exists
            let workspace = tx.get_workspace(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Add user to workspace with specified role
            tx.add_user_to_domain(member_id, workspace_id, role)?;
            Ok(())
        })
    }
    
    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission to remove users
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::RemoveUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Prevent removing the owner
            if let Some(workspace) = tx.get_workspace(workspace_id) {
                if workspace.owner_id == member_id {
                    return Err(NetworkError::msg(
                        "Cannot remove workspace owner from workspace"
                    ));
                }
            } else {
                return Err(NetworkError::msg(format!("Workspace '{}' not found", workspace_id)));
            }
            
            // Remove user from workspace
            tx.remove_user_from_domain(member_id, workspace_id)?;
            Ok(())
        })
    }
    
    fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Only admins can update roles
            if !self.is_admin(tx, actor_user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update roles",
                    actor_user_id
                )));
            }
            
            // Check if target user exists
            let target_user = tx.get_user(target_user_id).ok_or_else(|| {
                NetworkError::msg(format!("User '{}' not found", target_user_id))
            })?;
            
            // Cannot change role of workspace admin unless you're also an admin
            if target_user.role == UserRole::Admin && role != UserRole::Admin {
                let actor_is_admin = if let Some(actor) = tx.get_user(actor_user_id) {
                    actor.role == UserRole::Admin
                } else {
                    false
                };
                
                if !actor_is_admin {
                    return Err(NetworkError::msg("Cannot demote an admin unless you are also an admin"));
                }
            }
            
            // Update the user's role
            // Get the user and update their role
            if let Some(mut user) = tx.get_user_mut(target_user_id) {
                // Set permissions based on the new role
                user.clear_permissions(workspace_id);
                let permissions = super::Permission::for_role(&role);
                for permission in permissions {
                    user.add_permission(workspace_id, permission);
                }
                // Update the user
                tx.update_user(target_user_id, user.clone())?;
                Ok(())
            } else {
                Err(NetworkError::msg(format!("User '{}' not found", target_user_id)))
            }
        })
    }
    
    fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        workspace_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if actor has permission to manage users
            if !self.check_entity_permission(tx, actor_user_id, workspace_id, super::Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update permissions in workspace '{}'",
                    actor_user_id, workspace_id
                )));
            }
            
            // Check if target user exists
            if tx.get_user(target_user_id).is_none() {
                return Err(NetworkError::msg(format!("Target user '{}' not found", target_user_id)));
            }
            
            // Check if workspace exists
            if tx.get_workspace(workspace_id).is_none() {
                return Err(NetworkError::msg(format!("Workspace '{}' not found", workspace_id)));
            }
            
            // Update permissions based on operation
            match operation {
                UpdateOperation::Add => {
                    // Add permissions
                    for permission in permissions {
                        // Get the user and add the permission
                        if let Some(mut user) = tx.get_user_mut(target_user_id) {
                            user.add_permission(workspace_id, permission);
                            tx.update_user(target_user_id, user.clone())?;
                        } else {
                            return Err(NetworkError::msg(format!("User '{}' not found", target_user_id)));
                        }
                    }
                },
                UpdateOperation::Remove => {
                    // Remove permissions
                    for permission in permissions {
                        // Get the user and remove the permission
                        if let Some(mut user) = tx.get_user_mut(target_user_id) {
                            user.revoke_permission(workspace_id, permission);
                            tx.update_user(target_user_id, user.clone())?;
                        } else {
                            return Err(NetworkError::msg(format!("User '{}' not found", target_user_id)));
                        }
                    }
                },
                UpdateOperation::Set => {
                    // Clear existing permissions and set new ones
                    // Get the user and clear permissions
                    if let Some(mut user) = tx.get_user_mut(target_user_id) {
                        user.clear_permissions(workspace_id);
                        tx.update_user(target_user_id, user.clone())?;
                    } else {
                        return Err(NetworkError::msg(format!("User '{}' not found", target_user_id)));
                    }
                    for permission in permissions {
                        // Get the user and add the permission
                        if let Some(mut user) = tx.get_user_mut(target_user_id) {
                            user.add_permission(workspace_id, permission);
                            tx.update_user(target_user_id, user.clone())?;
                        } else {
                            return Err(NetworkError::msg(format!("User '{}' not found", target_user_id)));
                        }
                    }
                },
            }
            
            Ok(())
        })
    }
    
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to create a room in this office
            if !self.check_entity_permission(tx, user_id, office_id, super::Permission::CreateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create rooms in office '{}'",
                    user_id, office_id
                )));
            }
            
            // Check if office exists
            let office_domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Verify it's an office
            if let Domain::Office { office } = office_domain {
                // Generate room ID
                let room_id = uuid::Uuid::new_v4().to_string();
                
                // Create room
                let room = Room {
                    id: room_id.clone(),
                    owner_id: user_id.to_string(),
                    office_id: office_id.to_string(),
                    name: name.to_string(),
                    description: description.to_string(),
                    members: Vec::new(),
                    mdx_content: mdx_content.unwrap_or("").to_string(),
                    metadata: Vec::new(),
                };
                
                // Add room to domain storage
                tx.insert_domain(room_id.clone(), Domain::Room { room: room.clone() })?;
                
                // Update office to include the room
                let mut updated_office = office;
                updated_office.rooms.push(room_id.clone());
                tx.update_domain(office_id.to_string(), Domain::Office { office: updated_office })?;
                
                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user has permission to access this office
            if !self.check_entity_permission(tx, user_id, office_id, super::Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access office '{}'",
                    user_id, office_id
                )));
            }
            
            // Get the office domain
            let domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Verify it's an office
            if let Domain::Office { office: _ } = domain {
                // Return the office ID as required by trait signature
                Ok(office_id.to_string())
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }
    
    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user has permission to access this room
            if !self.check_entity_permission(tx, user_id, room_id, super::Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access room '{}'",
                    user_id, room_id
                )));
            }
            
            // Get the room domain
            let domain = tx.get_domain(room_id).ok_or_else(|| {
                NetworkError::msg(format!("Room '{}' not found", room_id))
            })?;
            
            // Convert to room
            if let Domain::Room { room } = domain {
                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }
    
    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to delete this office
            if !self.check_entity_permission(tx, user_id, office_id, super::Permission::DeleteOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }
            
            // Get the office domain
            let domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Verify it's an office and extract it
            if let Domain::Office { office } = domain.clone() {
                // Get parent workspace
                let workspace_id = office.workspace_id.clone();
                
                // Get workspace to update its offices list
                if let Some(Domain::Workspace { mut workspace }) = tx.get_domain(&workspace_id) {
                    // Remove office from workspace's list of offices
                    workspace.offices.retain(|id| id != &office_id.to_string());
                    // Update workspace
                    tx.update_domain(workspace_id, Domain::Workspace { workspace })?;
                }
                
                // Delete all rooms in this office
                for room_id in office.rooms.iter() {
                    tx.remove_domain(room_id)?;
                }
                
                // Finally delete the office
                tx.remove_domain(office_id)?;
                
                Ok(office)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }
    
    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to delete this room
            if !self.check_entity_permission(tx, user_id, room_id, super::Permission::DeleteRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete room '{}'",
                    user_id, room_id
                )));
            }
            
            // Get the room domain
            let domain = tx.get_domain(room_id).ok_or_else(|| {
                NetworkError::msg(format!("Room '{}' not found", room_id))
            })?;
            
            // Verify it's a room and extract it
            if let Domain::Room { room } = domain.clone() {
                // Get parent office
                let office_id = room.office_id.clone();
                
                // Get office to update its rooms list
                if let Some(Domain::Office { mut office }) = tx.get_domain(&office_id) {
                    // Remove room from office's list of rooms
                    office.rooms.retain(|id| id != &room_id.to_string());
                    // Update office
                    tx.update_domain(&office_id, Domain::Office { office })?;
                }
                
                // Delete the room
                tx.remove_domain(room_id)?;
                
                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }
    
    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user has permission to access this workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Get the workspace domain
            let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Verify it's a workspace
            if let Domain::Workspace { workspace } = domain {
                Ok(workspace)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }
    
    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        self.get_workspace(user_id, ws_id)
    }
    
    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Generate workspace ID
            let workspace_id = uuid::Uuid::new_v4().to_string();
            
            // Create workspace
            let workspace = Workspace {
                id: workspace_id.clone(),
                owner_id: user_id.to_string(),
                name: name.to_string(),
                description: description.to_string(),
                members: vec![user_id.to_string()],
                offices: Vec::new(),
                metadata: metadata.unwrap_or_default(),
                password_protected: !workspace_password.is_empty(),
            };
            
            // Add workspace to domain storage
            tx.insert_domain(workspace_id.clone(), Domain::Workspace { workspace: workspace.clone() })?;
            
            // Ensure the user has admin permissions for this workspace
            tx.add_user_to_domain(user_id, &workspace_id, super::UserRole::Admin)?;
            
            Ok(workspace)
        })
    }
    
    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to modify the workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::UpdateWorkspace)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add offices to workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Check if office exists
            let office_domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Get workspace
            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Verify entities are of correct type
            if let Domain::Office { mut office } = office_domain {
                if let Domain::Workspace { mut workspace } = workspace_domain {
                    // Update office to reference this workspace
                    office.workspace_id = workspace_id.to_string();
                    tx.update_domain(office_id, Domain::Office { office: office.clone() })?;
                    
                    // Add office to workspace's list
                    if !workspace.offices.contains(&office_id.to_string()) {
                        workspace.offices.push(office_id.to_string());
                        tx.update_domain(workspace_id, Domain::Workspace { workspace })?;
                    }
                    
                    Ok(())
                } else {
                    Err(NetworkError::msg(format!(
                        "Entity '{}' is not a workspace",
                        workspace_id
                    )))
                }
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }
    
    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to modify the workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::UpdateWorkspace)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove offices from workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Get workspace
            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Check if office exists and belongs to this workspace
            let office_domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Verify entities are of correct type
            if let Domain::Office { office } = &office_domain {
                if office.workspace_id != workspace_id {
                    return Err(NetworkError::msg(format!(
                        "Office '{}' does not belong to workspace '{}'",
                        office_id, workspace_id
                    )));
                }
            } else {
                return Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )));
            }
            
            // Update workspace to remove the office
            if let Domain::Workspace { mut workspace } = workspace_domain {
                workspace.offices.retain(|id| id != office_id);
                tx.update_domain(workspace_id, Domain::Workspace { workspace })?;
                
                // Note: We don't update the office itself - it remains but is no longer part of the workspace
                // This allows it to be potentially re-added later
                
                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }
    
    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Get all domains
            let domains = tx.get_all_domains()?;
            
            // Filter and convert to workspaces
            let mut workspaces = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Workspace { workspace } = domain {
                    // Only include workspaces the user has access to
                    if self.check_entity_permission(tx, user_id, &workspace.id, super::Permission::All)? {
                        workspaces.push(workspace);
                    }
                }
            }
            
            Ok(workspaces)
        })
    }
    
    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to update this office
            if !self.check_entity_permission(tx, user_id, office_id, super::Permission::UpdateOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }
            
            // Get the office domain
            let domain = tx.get_domain(office_id).ok_or_else(|| {
                NetworkError::msg(format!("Office '{}' not found", office_id))
            })?;
            
            // Verify it's an office and update it
            if let Domain::Office { mut office } = domain {
                // Update fields if provided
                if let Some(n) = name { office.name = n.to_string(); }
                if let Some(d) = description { office.description = d.to_string(); }
                if let Some(m) = mdx_content { office.mdx_content = m.to_string(); }
                
                // Update domain in storage
                let updated_domain = Domain::Office { office: office.clone() };
                tx.update_domain(office_id, updated_domain)?;
                
                Ok(office)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }
    
    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to update this room
            if !self.check_entity_permission(tx, user_id, room_id, super::Permission::UpdateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update room '{}'",
                    user_id, room_id
                )));
            }
            
            // Get the room domain
            let domain = tx.get_domain(room_id).ok_or_else(|| {
                NetworkError::msg(format!("Room '{}' not found", room_id))
            })?;
            
            // Verify it's a room and update it
            if let Domain::Room { mut room } = domain {
                // Update fields if provided
                if let Some(n) = name { room.name = n.to_string(); }
                if let Some(d) = description { room.description = d.to_string(); }
                if let Some(m) = mdx_content { room.mdx_content = m.to_string(); }
                
                // Update domain in storage
                let updated_domain = Domain::Room { room: room.clone() };
                tx.update_domain(room_id, updated_domain)?;
                
                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }
    
    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If workspace_id is provided, check if user has permission to access it
            if let Some(ws_id) = &workspace_id {
                if !self.check_entity_permission(tx, user_id, ws_id, super::Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list offices in workspace '{}'",
                        user_id, ws_id
                    )));
                }
            }
            
            // Get all domains
            let domains = tx.get_all_domains()?;
            
            // Filter and convert to offices
            let mut offices = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Office { office } = domain {
                    // If workspace_id is provided, only include offices from that workspace
                    if let Some(ws_id) = &workspace_id {
                        if office.workspace_id == *ws_id {
                            offices.push(office);
                        }
                    } else {
                        // If no workspace_id, include all offices the user has access to
                        if self.check_entity_permission(tx, user_id, &office.id, super::Permission::All)? {
                            offices.push(office);
                        }
                    }
                }
            }
            
            Ok(offices)
        })
    }
    
    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If office_id is provided, check if user has permission to access it
            if let Some(o_id) = &office_id {
                if !self.check_entity_permission(tx, user_id, o_id, super::Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list rooms in office '{}'",
                        user_id, o_id
                    )));
                }
            }
            
            // Get all domains
            let domains = tx.get_all_domains()?;
            
            // Filter and convert to rooms
            let mut rooms = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Room { room } = domain {
                    // If office_id is provided, only include rooms from that office
                    if let Some(o_id) = &office_id {
                        if room.office_id == *o_id {
                            rooms.push(room);
                        }
                    } else {
                        // If no office_id, include all rooms the user has access to
                        if self.check_entity_permission(tx, user_id, &room.id, super::Permission::All)? {
                            rooms.push(room);
                        }
                    }
                }
            }
            
            Ok(rooms)
        })
    }
    
    fn create_office(
        &self, 
        user_id: &str, 
        workspace_id: &str, 
        name: &str, 
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }
            
            // Check if workspace exists
            let workspace = tx.get_workspace(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Check if user has permission to add offices to this workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::CreateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add offices to workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Generate a unique ID for the new office
            let office_id = uuid::Uuid::new_v4().to_string();
            
            // Create the office
            let office = Office {
                id: office_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                workspace_id: workspace_id.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Creator is the first member
                rooms: Vec::new(),
                mdx_content: mdx_content.unwrap_or_default(),
                metadata: Vec::new(),
            };
            
            // Add office to domain storage
            tx.insert_domain(office_id.clone(), Domain::Office { office: office.clone() })?;
            
            // Add office to workspace
            tx.add_office_to_workspace(&office_id, workspace_id)?;
            
            // Add owner as member with all permissions
            tx.add_user_to_workspace(user_id, &office_id, super::UserRole::Owner)?;
            
            // Add MDX content if provided
            if let Some(content) = mdx_content {
                tx.set_mdx_content(&office_id, content)?;
            }
            
            Ok(office)
        })
    }
    
    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }
            
            // Check if workspace exists
            let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Check if user has permission to update workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::UpdateWorkspace)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Verify it's a workspace and update it
            if let Domain::Workspace { mut workspace } = domain {
                // Update fields if provided
                if let Some(n) = name { workspace.name = n.to_string(); }
                if let Some(d) = description { workspace.description = d.to_string(); }
                if let Some(m) = metadata { workspace.metadata = m; }
                workspace.password_protected = !workspace_master_password.is_empty();
                tx.set_workspace_password(workspace_id, &workspace_master_password)?;
                
                // Update domain in storage
                let updated_domain = Domain::Workspace { workspace: workspace.clone() };
                tx.update_domain(workspace_id, updated_domain)?;
                
                Ok(workspace)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }
    
    fn load_workspace(&self, user_id: &str, workspace_id_opt: Option<&str>) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(workspace_id) = workspace_id_opt {
                // If a specific workspace ID is provided, check permissions and return it
                if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to access workspace '{}'",
                        user_id, workspace_id
                    )));
                }
                
                // Get the workspace domain
                let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                    NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
                })?;
                
                // Verify it's a workspace
                if let Domain::Workspace { workspace } = domain {
                    return Ok(workspace.clone());
                } else {
                    return Err(NetworkError::msg(format!(
                        "Entity '{}' is not a workspace",
                        workspace_id
                    )));
                }
            } else {
                // If no workspace ID provided, find the first workspace the user is a member of
                let domains = tx.get_all_domains()?;
                
                for (_id, domain) in domains {
                    if let Domain::Workspace { workspace } = domain {
                        if workspace.members.contains(&user_id.to_string()) ||
                           workspace.owner_id == user_id {
                            return Ok(workspace.clone());
                        }
                    }
                }
                
                // If no workspace found, return an error
                Err(NetworkError::msg(format!("No workspace found for user '{}'", user_id)))
            }
        })
    }

    
    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }
            
            // Check if workspace exists
            let workspace = tx.get_workspace(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Check if user has permission to delete workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::DeleteWorkspace)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Delete workspace
            tx.remove_workspace(workspace_id)?;
            
            Ok(())
        })
    }
    

    
    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            let all_domains = tx.get_all_domains();
            let mut workspace_ids = Vec::new();
            
            for domain in all_domains {
                if let Domain::Workspace { workspace } = domain {
                    workspace_ids.push(workspace.id.clone());
                }
            }
            
            let list = WorkspaceDBList {
                workspaces: workspace_ids,
            };
            Ok(list)
        })
    }
    
    fn list_offices_in_workspace(
        &self, 
        user_id: &str, 
        workspace_id: &str
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Check if user exists
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }
            
            // Check if workspace exists
            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;
            
            // Check if it's a workspace
            if let Domain::Workspace { workspace: _ } = workspace_domain {
                // Continue
            } else {
                return Err(NetworkError::msg(format!("Entity '{}' is not a workspace", workspace_id)));
            }
            
            // Check if user has permission to view workspace
            if !self.check_entity_permission(tx, user_id, workspace_id, super::Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view workspace '{}'",
                    user_id, workspace_id
                )));
            }
            
            // Get all offices in this workspace
            let offices = tx.list_offices_in_workspace(workspace_id)?;
            
            Ok(offices)
        })
    }
}
