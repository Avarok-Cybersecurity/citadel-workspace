use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use parking_lot::RwLock;
use std::collections::HashMap;
pub mod rbac;
pub mod read;
pub mod write;

/// Transaction trait defines common functionality for both read and write transactions
pub trait Transaction {
    fn workspace_password(&self, workspace_id: &str) -> Option<String>;
    fn set_workspace_password(
        &mut self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError>;
    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<&Domain>;

    /// Get a mutable reference to a domain (write transactions only)
    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain>;

    /// Get all domains
    fn get_all_domains(&self) -> Result<Vec<(String, Domain)>, NetworkError>;

    /// Get a workspace by ID
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace>;

    /// Get a mutable reference to a workspace (write transactions only)
    fn get_workspace_mut(&mut self, workspace_id: &str) -> Option<&mut Workspace>;

    /// Get all workspaces
    fn get_all_workspaces(&self) -> &HashMap<String, Workspace>;

    /// Get a user by ID
    fn get_user(&self, user_id: &str) -> Option<&User>;

    /// Get a mutable reference to a user (write transactions only)
    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User>;

    /// Get all users
    fn get_all_users(&self) -> &HashMap<String, User>;

    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;

    /// Insert a domain
    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError>;

    /// Insert a workspace
    fn insert_workspace(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError>;

    /// Insert a user
    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError>;

    /// Update a domain
    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError>;

    /// Update a workspace
    fn update_workspace(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError>;

    /// Update a user
    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError>;

    /// Remove a domain and return it
    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError>;

    /// Remove a workspace and return it
    fn remove_workspace(&mut self, workspace_id: &str) -> Result<Option<Workspace>, NetworkError>;

    /// Remove a user and return it
    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError>;

    /// Add a user to a domain
    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Remove a user from a domain
    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError>;

    /// Commit changes (only applies to write transactions)
    fn commit(&self) -> Result<(), NetworkError> {
        Ok(()) // Default implementation, will be overridden for write transactions
    }

    /// Get a user's role
    fn get_user_role(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError>;

    /// Get a user's permissions
    fn get_permissions(&self, user_id: &str) -> Result<Vec<Permission>, NetworkError>;

    /// Get a role
    fn get_role(&self, role_id: &str) -> Result<Option<UserRole>, NetworkError>;

    /// Create a role
    fn create_role(&mut self, role: UserRole) -> Result<(), NetworkError>;

    /// Delete a role
    fn delete_role(&mut self, role_id: &str) -> Result<(), NetworkError>;

    /// Assign a role to a user
    fn assign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError>;

    /// Unassign a role from a user
    fn unassign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError>;
}

/// Extended transaction interface to add, get, and remove workspaces
pub trait WorkspaceOperations {
    /// Get a workspace by ID
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace>;

    /// Add a workspace with the given ID
    fn add_workspace(
        &mut self,
        workspace_id: &str,
        workspace: &mut Workspace,
    ) -> Result<(), NetworkError>;

    /// Remove a workspace
    fn remove_workspace(&mut self, workspace_id: &str) -> Result<(), NetworkError>;

    /// Update a workspace
    fn update_workspace(
        &mut self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError>;
}

/// Type of domain change in a transaction for rollback support
pub enum DomainChange {
    Insert(String),
    Update(String, Domain),
    Remove(String, Domain),
}

/// Type of user change in a transaction for rollback support
pub enum UserChange {
    Insert(String),
    Update(String, User),
    Remove(String, User),
}

/// Type of workspace change in a transaction for rollback support
pub enum WorkspaceChange {
    Insert(String),
    Update(String, Workspace),
    Remove(String, Workspace),
}

/// Transaction manager for creating read and write transactions
#[derive(Default)]
pub struct TransactionManager {
    pub domains: RwLock<HashMap<String, Domain>>,
    pub users: RwLock<HashMap<String, User>>,
    pub workspaces: RwLock<HashMap<String, Workspace>>,
    pub workspace_password: RwLock<HashMap<String, String>>,
}
