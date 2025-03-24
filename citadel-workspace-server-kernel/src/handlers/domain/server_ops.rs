use crate::handlers::domain;
use crate::handlers::domain::{DomainEntity, DomainOperations};
use crate::handlers::transaction::Transaction;
use crate::structs::{Domain, Office, Permission, Room, User, UserRole};
use crate::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::sync::Arc;
use uuid::Uuid;

/// Server-side implementation of domain operations
pub struct ServerDomainOps<R: Ratchet> {
    kernel: Arc<WorkspaceServerKernel<R>>,
}

impl<R: Ratchet> ServerDomainOps<R> {
    /// Create a new instance of ServerDomainOps
    pub fn new(kernel: Arc<WorkspaceServerKernel<R>>) -> Self {
        Self { kernel }
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_read_transaction(f)
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_write_transaction(f)
    }
}

impl<R: Ratchet> DomainOperations<R> for ServerDomainOps<R> {
    fn init(&self) -> Result<(), NetworkError> {
        // Nothing to initialize for the server implementation
        Ok(())
    }

    fn kernel(&self) -> &WorkspaceServerKernel<R> {
        &self.kernel
    }

    fn is_admin(&self, user_id: &str) -> bool {
        // Delegate to the kernel's admin check
        self.kernel.is_admin(user_id)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        // Use transaction manager to get user
        self.kernel
            .with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Delegate to the centralized permission checking system in the kernel
        self.kernel
            .check_entity_permission(user_id, entity_id, permission)
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        // Fix recursive call - use kernel method directly
        self.kernel.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(domain_id) {
                match domain {
                    Domain::Office { office } => Ok(office.members.contains(&user_id.to_string())),
                    Domain::Room { room } => {
                        if room.members.contains(&user_id.to_string()) {
                            Ok(true)
                        } else {
                            // Check if the user is a member of the parent office
                            self.is_member_of_domain(user_id, &room.office_id)
                        }
                    }
                }
            } else {
                Err(NetworkError::msg("Domain not found"))
            }
        })
    }

    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Since this is identical to check_entity_permission, just call that
        self.check_entity_permission(user_id, entity_id, permission)
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        DomainOperations::with_read_transaction(self, |tx| Ok(tx.get_domain(domain_id).cloned()))
            .ok()
            .flatten()
    }

    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError> {
        self.kernel.with_write_transaction(|tx| {
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

            // Update domain with updated user list
            match domain {
                Domain::Office { mut office } => {
                    // Add user to members if not already present
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Room { mut room } => {
                    // Add user to members if not already present
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
            }
        })
    }

    fn remove_user_from_domain(&self, _user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.kernel.with_write_transaction(|tx| {
            // Get domain by ID
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

            // Remove user from domain
            match domain {
                Domain::Office { mut office } => {
                    // Remove user from members
                    office.members.retain(|id| id != _user_id);
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Room { mut room } => {
                    // Remove user from members
                    room.members.retain(|id| id != _user_id);
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
            }
        })
    }

    fn get_domain_entity<T>(&self, _user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_read_transaction(|tx| {
            // Get domain by ID
            let domain = tx.get_domain(entity_id).ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Convert to the requested type
            T::from_domain(domain.clone()).ok_or_else(|| {
                domain::permission_denied(format!("Entity is not of the requested type"))
            })
        })
    }

    fn create_domain_entity<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Get parent domain if provided
            if let Some(parent_id) = parent_id {
                if !self.can_access_domain(user_id, parent_id)? {
                    return Err(domain::permission_denied("Cannot access parent domain"));
                }
            }

            // Create entity with appropriate ID
            let entity_id = uuid::Uuid::new_v4().to_string();
            let entity = if std::any::type_name::<T>().contains("Office") {
                let office = Office {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    rooms: Vec::new(),
                    mdx_content: String::new(),
                };

                // Insert the office domain
                tx.insert_domain(
                    entity_id.clone(),
                    Domain::Office {
                        office: office.clone(),
                    },
                )?;

                // Convert back to T
                T::from_domain(Domain::Office { office })
                    .ok_or_else(|| domain::permission_denied("Failed to convert to entity type"))?
            } else if std::any::type_name::<T>().contains("Room") {
                let parent = parent_id
                    .ok_or_else(|| domain::permission_denied("Room requires a parent office ID"))?
                    .to_string();

                let room = Room {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    office_id: parent,
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    mdx_content: String::new(),
                };

                // Insert the room domain
                tx.insert_domain(entity_id.clone(), Domain::Room { room: room.clone() })?;

                // Convert back to T
                T::from_domain(Domain::Room { room })
                    .ok_or_else(|| domain::permission_denied("Failed to convert to entity type"))?
            } else {
                return Err(domain::permission_denied("Unsupported entity type"));
            };

            Ok(entity)
        })
    }

    fn delete_domain_entity<T>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to delete
            if !self.can_access_domain(user_id, entity_id)? {
                return Err(domain::permission_denied("No permission to delete entity"));
            }

            // Get the domain first to return it later
            let domain = tx.get_domain(entity_id).cloned().ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Remove domain
            tx.remove_domain(entity_id)?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| domain::permission_denied("Entity is not of the requested type"))
        })
    }

    fn list_domain_entities<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        // Get all domains of the specified type
        let all_domains = DomainOperations::with_read_transaction(self, |tx| {
            let domains = tx.get_all_domains();
            Ok(domains.values().cloned().collect::<Vec<Domain>>())
        })?;

        // Filter domains by type and parent ID
        let mut filtered_domains = Vec::new();
        for domain in all_domains {
            // Skip domains that don't match the requested type
            if T::from_domain(domain.clone()).is_none() {
                continue;
            }

            // Filter by parent ID if specified
            if let Some(parent_id) = parent_id {
                if let Domain::Room { room } = &domain {
                    if room.office_id != parent_id {
                        continue;
                    }
                }
            }

            // Check if user has access to this domain
            if let Ok(has_access) = ServerDomainOps::can_access_domain(self, user_id, domain.id()) {
                if has_access {
                    if let Some(entity) = T::from_domain(domain) {
                        filtered_domains.push(entity);
                    }
                }
            }
        }

        Ok(filtered_domains)
    }

    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Office, NetworkError> {
        self.with_write_transaction(|tx| {
            // Generate ID for the new office
            let id = uuid::Uuid::new_v4().to_string();

            // Create the office
            let office = Office {
                id: id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Owner is automatically a member
                rooms: Vec::new(),                  // Initialize with empty rooms
                mdx_content: String::new(),         // Initialize with empty MDX content
            };

            // Insert into domains
            tx.insert_domain(
                id,
                Domain::Office {
                    office: office.clone(),
                },
            )?;

            Ok(office)
        })
    }

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Room, NetworkError> {
        // Check if user has permission to create a room in this office
        if !self.check_entity_permission(user_id, office_id, Permission::AddRoom)? {
            return Err(domain::permission_denied(
                "User does not have permission to create a room in this office",
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
                mdx_content: String::new(),         // Initialize with empty MDX content
            };

            // Add it to the database
            tx.insert_domain(room_id, Domain::Room { room: room.clone() })?;
            Ok(room)
        })
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // Get the office entity
        DomainOperations::get_domain_entity::<Office>(self, user_id, office_id)
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Check if user can access this room
        if !DomainOperations::check_room_access(self, user_id, room_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this room",
            ));
        }

        // Get the room entity
        DomainOperations::get_domain_entity::<Room>(self, user_id, room_id)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        DomainOperations::delete_domain_entity::<Office>(self, user_id, office_id)
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        DomainOperations::delete_domain_entity::<Room>(self, user_id, room_id)
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.update_domain_entity::<Office>(user_id, office_id, name, description)
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.update_domain_entity::<Room>(user_id, room_id, name, description)
    }

    fn list_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        DomainOperations::list_domain_entities(self, user_id, None)
    }

    fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // List rooms in this office
        DomainOperations::list_domain_entities::<Room>(self, user_id, Some(office_id))
    }

    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError> {
        // First check if user is room member or has explicit permissions
        if let Some(user) = self.get_user(user_id) {
            if user.is_member_of_domain(room_id) {
                return Ok(true);
            }

            // Check if admin
            if DomainOperations::is_admin(self, user_id) {
                return Ok(true);
            }

            // Get the room
            DomainOperations::with_read_transaction(self, |tx| {
                if let Some(Domain::Room { room }) = tx.get_domain(room_id) {
                    // Check if user is a member of the parent office
                    if let Some(Domain::Office { office }) = tx.get_domain(&room.office_id) {
                        return Ok(office.owner_id == user_id
                            || office.members.contains(&user_id.to_string()));
                    }
                }

                Ok(false)
            })
        } else {
            Err(domain::permission_denied("Room not found"))
        }
    }

    fn update_domain_entity<T>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to update
            if !self.can_access_domain(user_id, domain_id)? {
                return Err(domain::permission_denied("No permission to update entity"));
            }

            // Get domain by ID
            let mut domain = tx.get_domain(domain_id).cloned().ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", domain_id))
            })?;

            // Update domain properties
            match &mut domain {
                Domain::Office { ref mut office } => {
                    if let Some(name) = name {
                        office.name = name.to_string();
                    }
                    if let Some(description) = description {
                        office.description = description.to_string();
                    }
                }
                Domain::Room { ref mut room } => {
                    if let Some(name) = name {
                        room.name = name.to_string();
                    }
                    if let Some(description) = description {
                        room.description = description.to_string();
                    }
                }
            }

            // Update domain
            tx.update_domain(domain_id, domain.clone())?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| domain::permission_denied("Entity is not of the requested type"))
        })
    }
}

impl<R: Ratchet> ServerDomainOps<R> {
    /// Helper method to check if user can access a domain
    pub fn can_access_domain(&self, user_id: &str, entity_id: &str) -> Result<bool, NetworkError> {
        // Admins can access all domains
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user is a member of the domain
        self.is_member_of_domain(user_id, entity_id)
    }

    /// Helper method to check global permission
    pub fn check_global_permission(
        &self,
        user_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // System administrators always have all global permissions
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user has the specific global permission
        if let Some(user) = self.get_user(user_id) {
            if user.has_permission("global", permission) {
                return Ok(true);
            }

            // Check if the user's role grants this permission
            match user.role {
                UserRole::Admin => Ok(true), // Admins have all permissions
                UserRole::Owner => {
                    // Owners can manage their domains but not system-wide settings
                    match permission {
                        Permission::CreateEntity => Ok(true),
                        Permission::AddOffice => Ok(true),
                        Permission::AddRoom => Ok(true),
                        Permission::ViewContent => Ok(true),
                        Permission::EditOfficeConfig => Ok(true),
                        Permission::EditRoomConfig => Ok(true),
                        Permission::DeleteOffice => Ok(true),
                        Permission::DeleteRoom => Ok(true),
                        _ => Ok(false),
                    }
                }
                _ => Ok(false), // Other roles don't have global permissions by default
            }
        } else {
            Err(domain::permission_denied(format!(
                "User with ID {} not found",
                user_id
            )))
        }
    }
}
