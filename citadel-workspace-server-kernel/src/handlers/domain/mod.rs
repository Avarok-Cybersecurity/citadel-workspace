use citadel_sdk::prelude::{NetworkError, Ratchet};
// Re-export WorkspacePasswordPair publicly - REMOVING THIS LINE as it's not in citadel_workspace_types
// Import other structs for use within the domain module
use crate::kernel::transaction::Transaction;
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};
// Corrected import path for WorkspaceDBList based on compiler suggestion
use crate::handlers::domain::functions::workspace::workspace_ops::WorkspaceDBList;

pub mod entity;
pub mod functions;
pub mod server_ops;
pub mod workspace_entity;

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
    fn create(id: String, parent_id: Option<String>, name: &str, description: &str) -> Self
    where
        Self: Sized;

    // Extract from Domain enum
    fn from_domain(domain: Domain) -> Option<Self>
    where
        Self: Sized;
}

/// Domain operations trait
#[auto_impl::auto_impl(Arc)]
pub trait DomainOperations<R: Ratchet + Send + Sync + 'static> {
    /// Initialize domain operations
    fn init(&self) -> Result<(), NetworkError>;

    /// Check if a user is an admin
    fn is_admin(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError>;

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
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError>;

    /// Check if a user is a member of a domain
    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError>;

    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<Domain>;

    /// Add a user to a domain
    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Remove a user from a domain
    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError>;

    /// Get a domain entity
    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;

    /// Create a domain entity
    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
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
        mdx_content: Option<&str>,
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
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<String, NetworkError>;

    /// Create a room
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// Get an office
    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError>;

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
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError>;

    /// Update a room
    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// List offices
    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError>;

    /// List rooms
    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError>;

    /// Get a workspace
    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError>;

    /// Get workspace details (potentially more verbose than get_workspace)
    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError>;

    /// Create a workspace
    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Delete a workspace
    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError>;

    /// Update a workspace
    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Add an office to a workspace
    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;

    /// Remove an office from a workspace
    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;

    /// Add a user to a workspace
    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Remove a user from a workspace
    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError>;

    /// Load the primary workspace for a user (or a specific one if ID provided)
    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError>;

    /// List all workspaces accessible by a user
    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError>;

    /// Get all workspace IDs (primarily for internal server use)
    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError>;

    /// List offices in a specific workspace for a user
    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError>;
}
