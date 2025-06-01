use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};
use parking_lot::RwLock;
use rocksdb::DB;
use std::collections::HashMap;
use std::sync::Arc;
pub mod rbac;
pub mod read;
pub mod write;

pub use self::rbac::retrieve_role_permissions;
pub use self::rbac::DomainType;

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
pub struct TransactionManager {
    pub domains: RwLock<HashMap<String, Domain>>,
    pub users: RwLock<HashMap<String, User>>,
    pub workspaces: RwLock<HashMap<String, Workspace>>,
    pub workspace_password: RwLock<HashMap<String, String>>,
    pub db: Arc<DB>,
}

impl TransactionManager {
    pub fn new(db: Arc<DB>) -> Self {
        let mut domains_map = HashMap::new();
        let mut users_map = HashMap::new();
        let mut workspaces_map = HashMap::new();
        // workspace_password map is not persisted in this manner, handled differently or ephemeral

        println!("[TM_NEW_PRINTLN] Initializing TransactionManager: Loading data from RocksDB...");

        let iter = db.iterator(rocksdb::IteratorMode::Start);
        for result in iter {
            match result {
                Ok((key_bytes, value_bytes)) => {
                    let key_str = match std::str::from_utf8(&key_bytes) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("[TM_NEW_ERROR_PRINTLN] Failed to convert key to UTF-8: {}. Skipping entry.", e);
                            continue;
                        }
                    };

                    if key_str.starts_with("domain::") {
                        match bincode::deserialize::<Domain>(&value_bytes) {
                            Ok(domain) => {
                                let domain_id = key_str.trim_start_matches("domain::").to_string();
                                println!("[TM_NEW_PRINTLN] Loading domain: {}", domain_id);
                                domains_map.insert(domain_id, domain);
                            }
                            Err(e) => {
                                eprintln!("[TM_NEW_ERROR_PRINTLN] Failed to deserialize domain for key {}: {}. Skipping entry.", key_str, e);
                            }
                        }
                    } else if key_str.starts_with("user::") {
                        match bincode::deserialize::<User>(&value_bytes) {
                            Ok(user) => {
                                let user_id = key_str.trim_start_matches("user::").to_string();
                                println!("[TM_NEW_PRINTLN] Loading user: {}", user_id);
                                users_map.insert(user_id, user);
                            }
                            Err(e) => {
                                eprintln!("[TM_NEW_ERROR_PRINTLN] Failed to deserialize user for key {}: {}. Skipping entry.", key_str, e);
                            }
                        }
                    } else if key_str.starts_with("workspace::") {
                        match bincode::deserialize::<Workspace>(&value_bytes) {
                            Ok(workspace) => {
                                let workspace_id =
                                    key_str.trim_start_matches("workspace::").to_string();
                                println!("[TM_NEW_PRINTLN] Loading workspace: {}", workspace_id);
                                workspaces_map.insert(workspace_id, workspace);
                            }
                            Err(e) => {
                                eprintln!("[TM_NEW_ERROR_PRINTLN] Failed to deserialize workspace for key {}: {}. Skipping entry.", key_str, e);
                            }
                        }
                    } else {
                        // Optional: Log other keys if necessary, or ignore them if they are not managed by TransactionManager caches
                        // println!("[TM_NEW_PRINTLN] Skipping unrecognized key prefix: {}", key_str);
                    }
                }
                Err(e) => {
                    eprintln!("[TM_NEW_ERROR_PRINTLN] Error iterating RocksDB: {}. Aborting further loading.", e);
                    break; // Or handle more gracefully, e.g., by returning a Result from new()
                }
            }
        }

        println!(
            "[TM_NEW_PRINTLN] RocksDB loading complete. Domains: {}, Users: {}, Workspaces: {}.",
            domains_map.len(),
            users_map.len(),
            workspaces_map.len()
        );

        Self {
            domains: RwLock::new(domains_map),
            users: RwLock::new(users_map),
            workspaces: RwLock::new(workspaces_map),
            workspace_password: RwLock::new(HashMap::new()), // Remains empty, not loaded from DB this way
            db,
        }
    }
}
