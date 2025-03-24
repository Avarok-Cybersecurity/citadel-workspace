use citadel_sdk::prelude::{NetworkError, Ratchet};
use crate::handlers::transaction::{Transaction};
use crate::kernel::WorkspaceServerKernel;
use crate::structs::{Office, Room, Domain, UserRole, User, Permission};
use std::sync::Arc;
use uuid::Uuid;

// NetworkError helpers (using functions instead of impl extension)
fn permission_denied<S: std::fmt::Display>(msg: S) -> NetworkError {
    NetworkError::msg(format!("Permission denied: {msg}"))
}

/// DomainEntity trait for entities that belong to a domain
pub trait DomainEntity: Clone + Send + Sync + 'static {
    fn id(&self) -> String;
    fn name(&self) -> String;
    fn description(&self) -> String;
    fn owner_id(&self) -> String;
    fn domain_id(&self) -> String;
    
    // Convert to Domain enum
    fn into_domain(self) -> Domain where Self: Sized;
    
    // Create a new entity
    fn create(id: String, name: &str, description: &str) -> Self where Self: Sized;
    
    // Extract from Domain enum
    fn from_domain(domain: Domain) -> Option<Self> where Self: Sized;
}

/// Domain operations trait
pub trait DomainOperations<R: Ratchet> {
    /// Initialize domain operations
    fn init(&self) -> Result<(), NetworkError>;
    
    /// Get the workspace server kernel
    fn kernel(&self) -> &WorkspaceServerKernel<R>;
    
    /// Check if a user is an admin
    fn is_admin(&self, user_id: &str) -> bool;
    
    /// Get a user by ID
    fn get_user(&self, user_id: &str) -> Option<User>;
    
    /// Execute a function with a read transaction
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>;
    
    /// Execute a function with a write transaction
    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>;
    
    /// Check if a user has a specific permission for an entity
    fn check_entity_permission(&self, user_id: &str, entity_id: &str, permission: Permission) -> Result<bool, NetworkError>;
    
    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;
    
    /// Check if a user has a specific permission
    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission
    ) -> Result<bool, NetworkError>;
    
    /// Check if a user has access to a room
    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError>;
    
    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<Domain>;
    
    /// Add a user to a domain
    fn add_user_to_domain(&self, user_id: &str, domain_id: &str, _role: UserRole) -> Result<(), NetworkError>;
    
    /// Remove a user from a domain
    fn remove_user_from_domain(&self, _user_id: &str, domain_id: &str) -> Result<(), NetworkError>;
    
    /// Get a domain entity
    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;
    
    /// Create a domain entity
    fn create_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
    ) -> Result<T, NetworkError>;
    
    /// Delete a domain entity
    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;
    
    /// Update a domain entity
    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<T, NetworkError>;
    
    /// List domain entities
    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>;
    
    /// Create an office
    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Office, NetworkError>;
    
    /// Create a room
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Room, NetworkError>;
    
    /// Get an office
    fn get_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError>;
    
    /// Get a room
    fn get_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError>;
    
    /// Delete an office
    fn delete_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError>;
    
    /// Delete a room
    fn delete_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError>;
    
    /// Update an office
    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Office, NetworkError>;
    
    /// Update a room
    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Room, NetworkError>;
    
    /// List offices
    fn list_offices(
        &self,
        user_id: &str,
    ) -> Result<Vec<Office>, NetworkError>;
    
    /// List rooms
    fn list_rooms(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Vec<Room>, NetworkError>;
}

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
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>
    {
        let tx = self.kernel.begin_read_transaction()?;
        f(&tx)
    }
    
    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>
    {
        let mut tx = self.kernel.begin_write_transaction()?;
        let result = f(&mut tx);
        if result.is_ok() {
            tx.commit()?;
        }
        result
    }
    
    // Helper method to check if user is member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        if self.is_admin(user_id) {
            return Ok(true);
        }
        
        self.with_read_transaction(|tx| {
            if let Some(domain) = tx.get_domain(domain_id) {
                match domain {
                    Domain::Office { office } => {
                        Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()))
                    },
                    Domain::Room { room } => {
                        // Check if user is a direct member of the room
                        if room.owner_id == user_id || room.members.contains(&user_id.to_string()) {
                            return Ok(true);
                        }
                        
                        // Check if user is a member of the office that contains this room
                        if let Some(office_domain) = tx.get_domain(&room.office_id) {
                            if let Domain::Office { office } = office_domain {
                                return Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()));
                            }
                        }
                        
                        Ok(false)
                    },
                }
            } else {
                Err(permission_denied("Domain not found"))
            }
        })
    }
    
    // Helper method to check if user can access a domain
    fn can_access_domain<T: DomainEntity + 'static>(&self, user_id: &str, entity_id: &str) -> Result<bool, NetworkError> {
        // Admins can access all domains
        if self.is_admin(user_id) {
            return Ok(true);
        }
        
        // Check if user is a member of the domain
        self.is_member_of_domain(user_id, entity_id)
    }
    
    // Helper method to check global permission
    fn check_global_permission(&self, user_id: &str, permission: Permission) -> Result<bool, NetworkError> {
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
                        _ => Ok(false)
                    }
                },
                _ => Ok(false) // Other roles don't have global permissions by default
            }
        } else {
            Err(permission_denied(format!("User with ID {} not found", user_id)))
        }
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
        // Admin check logic - can be enhanced with more sophisticated role checks
        user_id == "admin"
    }
    
    fn get_user(&self, user_id: &str) -> Option<User> {
        let users = self.kernel.users.read().unwrap();
        users.get(user_id).cloned()
    }
    
    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>
    {
        let tx = self.kernel.begin_read_transaction()?;
        f(&tx)
    }
    
    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>
    {
        let mut tx = self.kernel.begin_write_transaction()?;
        let result = f(&mut tx);
        if result.is_ok() {
            tx.commit()?;
        }
        result
    }
    
    fn check_entity_permission(&self, user_id: &str, entity_id: &str, permission: Permission) -> Result<bool, NetworkError> {
        // System administrators always have all permissions
        if DomainOperations::is_admin(self, user_id) {
            return Ok(true);
        }
        
        // Get the user
        if let Some(user) = self.get_user(user_id) {
            // Check if user has the specific permission for this entity
            if user.has_permission(entity_id, permission) {
                return Ok(true);
            }
            
            // If not explicitly granted, check based on role
            // First get the domain entity
            DomainOperations::with_read_transaction(self, |tx| {
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
                                            _ => Ok(false)
                                        }
                                    },
                                    _ => Ok(false)
                                }
                            } else {
                                Ok(false)
                            }
                        },
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
                                            Permission::ViewContent => Ok(true), // Members can view content
                                            _ => Ok(false)
                                        }
                                    },
                                    _ => Ok(false),
                                }
                            } else {
                                // For rooms, check if user has permission in parent office
                                if let Domain::Room { room } = &domain {
                                    let office_id = &room.office_id;
                                    return DomainOperations::check_entity_permission(self, user_id, office_id, permission);
                                }
                                
                                Ok(false)
                            }
                        },
                    }
                } else {
                    Err(permission_denied("Entity not found"))
                }
            })
        } else {
            Err(permission_denied(format!("User with ID {} not found", user_id)))
        }
    }
    
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.is_member_of_domain(user_id, domain_id)
    }
    
    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission
    ) -> Result<bool, NetworkError> {
        self.check_entity_permission(user_id, entity_id, permission)
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
                if let Some(domain) = tx.get_domain(room_id) {
                    if let Domain::Room { room } = domain {
                        // Check if user is a member of the parent office
                        if let Some(office_domain) = tx.get_domain(&room.office_id) {
                            if let Domain::Office { office } = office_domain {
                                return Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()));
                            }
                        }
                    }
                }
                
                Ok(false)
            })
        } else {
            Err(permission_denied("Room not found"))
        }
    }
    
    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        DomainOperations::with_read_transaction(self, |tx| Ok(tx.get_domain(domain_id).cloned())).ok().flatten()
    }
    
    fn add_user_to_domain(&self, user_id: &str, domain_id: &str, _role: UserRole) -> Result<(), NetworkError> {
        DomainOperations::with_write_transaction(self, |tx| {
            if let Some(mut domain) = tx.get_domain(domain_id).cloned() {
                match &mut domain {
                    Domain::Office { ref mut office } => {
                        // Add user to office
                        if !office.members.contains(&user_id.to_string()) {
                            office.members.push(user_id.to_string());
                            tx.update(domain_id, domain)?;
                        }
                    },
                    Domain::Room { ref mut room } => {
                        // Add user to room
                        if !room.members.contains(&user_id.to_string()) {
                            room.members.push(user_id.to_string());
                            tx.update(domain_id, domain)?;
                        }
                    },
                }
                Ok(())
            } else {
                Err(permission_denied("Domain not found"))
            }
        })
    }
    
    fn remove_user_from_domain(&self, _user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        DomainOperations::with_write_transaction(self, |tx| {
            if let Some(mut domain) = tx.get_domain(domain_id).cloned() {
                match &mut domain {
                    Domain::Office { ref mut office } => {
                        // Remove user from office
                        office.members.retain(|id| id != _user_id);
                        tx.update(domain_id, domain)?;
                    },
                    Domain::Room { ref mut room } => {
                        // Remove user from room
                        room.members.retain(|id| id != _user_id);
                        tx.update(domain_id, domain)?;
                    },
                }
                Ok(())
            } else {
                Err(permission_denied("Domain not found"))
            }
        })
    }
    
    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Use a read transaction to retrieve the domain
        if let Some(domain) = DomainOperations::get_domain(self, entity_id) {
            if let Some(entity) = T::from_domain(domain) {
                Ok(entity)
            } else {
                Err(permission_denied("Entity type mismatch"))
            }
        } else {
            Err(permission_denied("Entity not found"))
        }
    }
    
    fn create_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
    ) -> Result<T, NetworkError> {
        // Check if user has permission to create this type of entity
        if !self.check_global_permission(user_id, Permission::CreateEntity)? {
            return Err(permission_denied(format!(
                "User does not have permission to create this entity type"
            )));
        }
        
        // If parent_id is provided, check if user has permission to add to that parent
        if let Some(parent_id) = parent_id {
            if !DomainOperations::check_entity_permission(self, user_id, parent_id, Permission::AddRoom)? {
                return Err(permission_denied(format!(
                    "User does not have permission to add entities to this parent"
                )));
            }
        }
        
        // Generate a unique ID for the new entity
        let entity_id = Uuid::new_v4().to_string();
        
        // Create the entity
        let entity = T::create(entity_id, name, description);
        
        // Add it to the database
        DomainOperations::with_write_transaction(self, |tx| {
            tx.insert(entity.id(), entity.clone().into_domain());
            Ok(())
        })?;
        
        Ok(entity)
    }
    
    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        // Check if the entity exists first
        let _entity = match DomainOperations::get_domain_entity::<T>(self, user_id, entity_id) {
            Ok(e) => e,
            Err(e) => return Err(e),
        };
        
        // Determine the permission needed based on entity type
        let delete_permission = match std::any::type_name::<T>().contains("Office") {
            true => Permission::DeleteOffice,
            false => Permission::DeleteRoom,
        };
        
        if !DomainOperations::check_entity_permission(self, user_id, entity_id, delete_permission)? {
            return Err(permission_denied(format!(
                "User does not have permission to delete this entity"
            )));
        }
        
        // Delete the entity
        DomainOperations::with_write_transaction(self, |tx| {
            if let Some(domain) = tx.remove(entity_id)? {
                match domain {
                    Domain::Office { office: _ } => { /* Handle any additional cleanup for office */ },
                    Domain::Room { room: _ } => { /* Handle any additional cleanup for room */ },
                }
            }
            Ok(())
        })?;
        
        Ok(_entity)
    }
    
    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<T, NetworkError> {
        // Check if the entity exists first
        let _entity = match DomainOperations::get_domain_entity::<T>(self, user_id, domain_id) {
            Ok(e) => e,
            Err(e) => return Err(e),
        };
        
        // Determine the permission needed based on entity type
        let update_permission = match std::any::type_name::<T>().contains("Office") {
            true => Permission::EditOfficeConfig,
            false => Permission::EditRoomConfig,
        };
        
        if !DomainOperations::check_entity_permission(self, user_id, domain_id, update_permission)? {
            return Err(permission_denied(format!(
                "User does not have permission to update this entity"
            )));
        }
        
        // Get the current domain and create an updated copy
        DomainOperations::with_write_transaction(self, |tx| {
            if let Some(domain) = tx.get_domain(domain_id).cloned() {
                // Create an updated copy of the domain
                let mut domain = domain.clone();
                
                // Update the name and description based on entity type
                match &mut domain {
                    Domain::Office { ref mut office } => {
                        if let Some(name) = name {
                            office.name = name.to_string();
                        }
                        if let Some(description) = description {
                            office.description = description.to_string();
                        }
                    },
                    Domain::Room { ref mut room } => {
                        if let Some(name) = name {
                            room.name = name.to_string();
                        }
                        if let Some(description) = description {
                            room.description = description.to_string();
                        }
                    }
                }
                
                // Update the domain with the new version
                tx.update(domain_id, domain)?;
                Ok(())
            } else {
                Err(permission_denied("Entity not found"))
            }
        })?;
        
        // Return the updated entity
        DomainOperations::get_domain_entity(self, user_id, domain_id)
    }
    
    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
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
                match &domain {
                    Domain::Room { room } => {
                        if room.office_id != parent_id {
                            continue;
                        }
                    },
                    // Offices don't have parents in the simplified model
                    _ => {}
                }
            }
            
            // Check if user has access to this domain
            if let Ok(has_access) = ServerDomainOps::can_access_domain::<T>(self, user_id, domain.id()) {
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
        // Check if user has permission to create an office
        if !self.check_global_permission(user_id, Permission::AddOffice)? {
            return Err(permission_denied("User does not have permission to create an office"));
        }
        
        // Generate a unique ID for the new office
        let office_id = Uuid::new_v4().to_string();
        
        // Create the office
        let office = Office {
            id: office_id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            owner_id: user_id.to_string(),
            members: vec![user_id.to_string()], // Owner is automatically a member
            rooms: Vec::new(), // Initialize with empty rooms
            mdx_content: String::new(), // Initialize with empty MDX content
        };
        
        // Add it to the database
        DomainOperations::with_write_transaction(self, |tx| {
            tx.insert(office_id.clone(), Domain::Office { office: office.clone() });
            Ok(())
        })?;
        
        Ok(office)
    }
    
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
    ) -> Result<Room, NetworkError> {
        // Check if user has permission to create a room in this office
        if !DomainOperations::check_entity_permission(self, user_id, office_id, Permission::AddRoom)? {
            return Err(permission_denied("User does not have permission to create a room in this office"));
        }
        
        // Generate a unique ID for the new room
        let room_id = Uuid::new_v4().to_string();
        
        // Create the room
        let room = Room {
            id: room_id.clone(),
            name: name.to_string(),
            description: description.to_string(),
            owner_id: user_id.to_string(),
            office_id: office_id.to_string(),
            members: vec![user_id.to_string()], // Owner is automatically a member
            mdx_content: String::new(), // Initialize with empty MDX content
        };
        
        // Add it to the database
        DomainOperations::with_write_transaction(self, |tx| {
            tx.insert(room_id.clone(), Domain::Room { room: room.clone() });
            Ok(())
        })?;
        
        Ok(room)
    }
    
    fn get_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain::<Office>(self, user_id, office_id)? {
            return Err(permission_denied("User does not have permission to access this office"));
        }
        
        // Get the office entity
        DomainOperations::get_domain_entity::<Office>(self, user_id, office_id)
    }
    
    fn get_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        // Check if user can access this room
        if !DomainOperations::check_room_access(self, user_id, room_id)? {
            return Err(permission_denied("User does not have permission to access this room"));
        }
        
        // Get the room entity
        DomainOperations::get_domain_entity::<Room>(self, user_id, room_id)
    }
    
    fn delete_office(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Office, NetworkError> {
        DomainOperations::delete_domain_entity::<Office>(self, user_id, office_id)
    }
    
    fn delete_room(
        &self,
        user_id: &str,
        room_id: &str,
    ) -> Result<Room, NetworkError> {
        DomainOperations::delete_domain_entity::<Room>(self, user_id, room_id)
    }
    
    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Update the office entity
        DomainOperations::update_domain_entity::<Office>(self, user_id, office_id, name, description)
    }
    
    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Update the room entity
        DomainOperations::update_domain_entity::<Room>(self, user_id, room_id, name, description)
    }
    
    fn list_offices(
        &self,
        user_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        DomainOperations::list_domain_entities::<Office>(self, user_id, None)
    }
    
    fn list_rooms(
        &self,
        user_id: &str,
        office_id: &str,
    ) -> Result<Vec<Room>, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain::<Office>(self, user_id, office_id)? {
            return Err(permission_denied("User does not have permission to access this office"));
        }
        
        // List rooms in this office
        DomainOperations::list_domain_entities::<Room>(self, user_id, Some(office_id))
    }
}

/// Implement DomainEntity for Office
impl DomainEntity for Office {
    fn id(&self) -> String {
        self.id.clone()
    }
    
    fn name(&self) -> String {
        self.name.clone()
    }
    
    fn description(&self) -> String {
        self.description.clone()
    }
    
    fn owner_id(&self) -> String {
        self.owner_id.clone()
    }
    
    fn domain_id(&self) -> String {
        self.id.clone()
    }
    
    fn into_domain(self) -> Domain {
        Domain::Office { office: self }
    }
    
    fn create(id: String, name: &str, description: &str) -> Self {
        Office {
            id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            members: vec![],
            rooms: Vec::new(),
            mdx_content: String::new(),
        }
    }
    
    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Office { office } => Some(office),
            _ => None,
        }
    }
}

/// Implement DomainEntity for Room
impl DomainEntity for Room {
    fn id(&self) -> String {
        self.id.clone()
    }
    
    fn name(&self) -> String {
        self.name.clone()
    }
    
    fn description(&self) -> String {
        self.description.clone()
    }
    
    fn owner_id(&self) -> String {
        self.owner_id.clone()
    }
    
    fn domain_id(&self) -> String {
        self.office_id.clone()
    }
    
    fn into_domain(self) -> Domain {
        Domain::Room { room: self }
    }
    
    fn create(id: String, name: &str, description: &str) -> Self {
        Room {
            id,
            name: name.to_string(),
            description: description.to_string(),
            owner_id: "".to_string(),
            office_id: "".to_string(),
            members: vec![],
            mdx_content: String::new(),
        }
    }
    
    fn from_domain(domain: Domain) -> Option<Self> {
        match domain {
            Domain::Room { room } => Some(room),
            _ => None,
        }
    }
}
