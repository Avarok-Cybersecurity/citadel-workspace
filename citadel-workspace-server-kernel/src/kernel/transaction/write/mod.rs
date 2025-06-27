use crate::kernel::transaction::{
    DomainChange, Transaction, UserChange, WorkspaceChange, WorkspaceOperations,
};
use citadel_logging::debug;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, User, UserRole, Workspace};
use parking_lot::RwLockWriteGuard;
use rocksdb::DB;
use std::collections::HashMap;
use std::sync::Arc;

// Define submodules
mod domain_ops;
mod user_ops;
mod workspace_ops;
mod commit_ops;

// Re-export the operations
pub use domain_ops::*;
pub use user_ops::*;
pub use workspace_ops::*;
pub use commit_ops::*;

/// A writable transaction that can modify domains and users
pub struct WriteTransaction<'a> {
    pub(crate) domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    pub(crate) users: RwLockWriteGuard<'a, HashMap<String, User>>,
    pub(crate) workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
    pub(crate) workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
    pub(crate) domain_changes: Vec<DomainChange>,
    pub(crate) user_changes: Vec<UserChange>,
    pub(crate) workspace_changes: Vec<WorkspaceChange>,
    pub(crate) db: Arc<DB>,
}

impl<'a> WriteTransaction<'a> {
    /// Creates a new write transaction
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
        users: RwLockWriteGuard<'a, HashMap<String, User>>,
        workspaces: RwLockWriteGuard<'a, HashMap<String, Workspace>>,
        workspace_password: RwLockWriteGuard<'a, HashMap<String, String>>,
        db: Arc<DB>,
    ) -> Self {
        Self {
            domains,
            users,
            workspaces,
            workspace_password,
            domain_changes: Vec::new(),
            user_changes: Vec::new(),
            workspace_changes: Vec::new(),
            db,
        }
    }

    /// Rollback changes made in the transaction
    ///
    /// Note: This rollback only affects the in-memory changes tracked by this transaction.
    /// As per the Citadel Workspace transaction system behavior, changes made during a
    /// transaction are immediately applied to in-memory storage, and they are not
    /// automatically rolled back if the transaction returns an error.
    pub fn rollback(&mut self) -> Result<(), NetworkError> {
        // Revert domain changes
        for change in self.domain_changes.drain(..).rev() {
            match change {
                DomainChange::Insert(id) => {
                    self.domains.remove(&id);
                }
                DomainChange::Update(id, old_domain) => {
                    self.domains.insert(id, old_domain);
                }
                DomainChange::Remove(id, old_domain) => {
                    self.domains.insert(id, old_domain);
                }
            }
        }

        // Revert user changes
        for change in self.user_changes.drain(..).rev() {
            match change {
                UserChange::Insert(id) => {
                    self.users.remove(&id);
                }
                UserChange::Update(id, old_user) => {
                    self.users.insert(id, old_user);
                }
                UserChange::Remove(id, old_user) => {
                    self.users.insert(id, old_user);
                }
            }
        }

        // Revert workspace changes
        for change in self.workspace_changes.drain(..).rev() {
            match change {
                WorkspaceChange::Insert(id) => {
                    self.workspaces.remove(&id);
                }
                WorkspaceChange::Update(id, old_workspace) => {
                    self.workspaces.insert(id, old_workspace);
                }
                WorkspaceChange::Remove(id, old_workspace) => {
                    self.workspaces.insert(id, old_workspace);
                }
            }
        }

        Ok(())
    }
}

// Complete Transaction trait implementation
impl Transaction for WriteTransaction<'_> {
    // Password methods
    fn workspace_password(&self, workspace_id: &str) -> Option<String> {
        self.workspace_password.get(workspace_id).cloned()
    }

    fn set_workspace_password(
        &mut self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError> {
        let hashed_password = bcrypt::hash(password, 10)
            .map_err(|_| NetworkError::msg("Failed to hash password".to_string()))?;

        self.workspace_password
            .insert(workspace_id.to_string(), hashed_password);
        Ok(())
    }
    
    // Workspace operations
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.get_workspace_internal(workspace_id)
    }

    fn get_workspace_mut(&mut self, workspace_id: &str) -> Option<&mut Workspace> {
        self.get_workspace_mut_internal(workspace_id)
    }

    fn get_all_workspaces(&self) -> &std::collections::HashMap<String, Workspace> {
        self.get_all_workspaces_internal()
    }

    fn insert_workspace(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.insert_workspace_internal(workspace_id, workspace)
    }

    fn update_workspace(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.update_workspace_internal(workspace_id, new_workspace)
    }

    fn remove_workspace(&mut self, workspace_id: &str) -> Result<Option<Workspace>, NetworkError> {
        self.remove_workspace_internal(workspace_id)
    }
    
    // Domain operations
    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.get_domain_internal(domain_id)
    }

    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain> {
        self.get_domain_mut_internal(domain_id)
    }

    fn get_all_domains(&self) -> Result<Vec<(String, Domain)>, NetworkError> {
        self.get_all_domains_internal()
    }

    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.insert_domain_internal(domain_id, domain)
    }

    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        self.update_domain_internal(domain_id, new_domain)
    }

    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.remove_domain_internal(domain_id)
    }
    
    // User operations
    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.get_user_internal(user_id)
    }

    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.get_user_mut_internal(user_id)
    }

    fn get_all_users(&self) -> &std::collections::HashMap<String, User> {
        self.get_all_users_internal()
    }

    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.insert_user_internal(user_id, user)
    }

    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError> {
        self.update_user_internal(user_id, new_user)
    }

    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.remove_user_internal(user_id)
    }
    
    // Domain-User operations
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.is_member_of_domain_internal(user_id, domain_id)
    }

    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.add_user_to_domain_internal(user_id, domain_id, role)
    }

    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_user_from_domain_internal(user_id, domain_id)
    }
    
    // Role and permissions operations
    fn get_user_role(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError> {
        self.get_user_role_internal(user_id)
    }

    fn get_permissions(&self, user_id: &str) -> Result<Vec<Permission>, NetworkError> {
        self.get_permissions_internal(user_id)
    }

    fn get_role(&self, role_id: &str) -> Result<Option<UserRole>, NetworkError> {
        self.get_role_internal(role_id)
    }

    fn create_role(&mut self, role: UserRole) -> Result<(), NetworkError> {
        self.create_role_internal(role)
    }

    fn delete_role(&mut self, role_id: &str) -> Result<(), NetworkError> {
        self.delete_role_internal(role_id)
    }

    fn assign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError> {
        self.assign_role_internal(user_id, role_id)
    }

    fn unassign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError> {
        self.unassign_role_internal(user_id, role_id)
    }
    
    // Commit operation
    fn commit(&self) -> Result<(), NetworkError> {
        // Delegate to the actual implementation
        debug!("Committing transaction changes to database");
        
        // Note that in-memory changes are already applied at this point
        
        // Create a write batch for RocksDB
        let mut batch = rocksdb::WriteBatch::default();
        
        // Add domains to the batch
        for (id, domain) in self.domains.iter() {
            let domain_bytes = bincode::serialize(domain)
                .map_err(|_| NetworkError::msg(format!("Failed to serialize domain {}", id)))?;
            
            batch.put(format!("domain:{}", id), domain_bytes);
        }
        
        // Add users to the batch
        for (id, user) in self.users.iter() {
            let user_bytes = bincode::serialize(user)
                .map_err(|_| NetworkError::msg(format!("Failed to serialize user {}", id)))?;
            
            batch.put(format!("user:{}", id), user_bytes);
        }
        
        // Add workspaces to the batch
        for (id, workspace) in self.workspaces.iter() {
            let workspace_bytes = bincode::serialize(workspace)
                .map_err(|_| NetworkError::msg(format!("Failed to serialize workspace {}", id)))?;
            
            batch.put(format!("workspace:{}", id), workspace_bytes);
        }
        
        // Add workspace passwords to the batch
        for (id, password) in self.workspace_password.iter() {
            batch.put(format!("workspace_password:{}", id), password);
        }
        
        // Write the batch to the database
        self.db.write(batch)
            .map_err(|e| NetworkError::msg(format!("Failed to write transaction to database: {}", e)))
    }
}
