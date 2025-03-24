use citadel_sdk::prelude::{NetworkError, Ratchet};
use crate::handlers::transaction::Transaction;
use crate::structs::{Domain, Office, Permission, Room, User, UserRole};
use crate::WorkspaceServerKernel;

pub mod server_ops;
pub mod entity;

// NetworkError helpers (using functions instead of impl extension)
pub fn permission_denied<S: std::fmt::Display>(msg: S) -> NetworkError {
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
    fn into_domain(self) -> Domain
    where
        Self: Sized;

    // Create a new entity
    fn create(id: String, name: &str, description: &str) -> Self
    where
        Self: Sized;

    // Extract from Domain enum
    fn from_domain(domain: Domain) -> Option<Self>
    where
        Self: Sized;
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
    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError>;

    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;

    /// Check if a user has a specific permission
    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError>;

    /// Check if a user has access to a room
    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError>;

    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<Domain>;

    /// Add a user to a domain
    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError>;

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
    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError>;

    /// Get a room
    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

    /// Delete an office
    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError>;

    /// Delete a room
    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

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
    fn list_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError>;

    /// List rooms
    fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError>;
}