//! # Transaction Trait Implementation
//!
//! This module contains the complete implementation of the Transaction trait for WriteTransaction.
//! It delegates to specialized operation modules for clean separation of concerns.

use super::WriteTransaction;
use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Permission, User, UserRole, Workspace};

/// Complete implementation of the Transaction trait for WriteTransaction.
///
/// This implementation provides all required transaction operations by delegating
/// to specialized operation modules. The delegation pattern ensures clean separation
/// of concerns while maintaining a unified transaction interface.
impl Transaction for WriteTransaction<'_> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // PASSWORD MANAGEMENT OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────
    
    /// Retrieves the stored password hash for a workspace
    fn workspace_password(&self, workspace_id: &str) -> Option<String> {
        self.workspace_password.get(workspace_id).cloned()
    }

    /// Sets a new password for a workspace with secure bcrypt hashing
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

    // ────────────────────────────────────────────────────────────────────────────
    // WORKSPACE OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a workspace by ID (read-only access)
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.get_workspace_internal(workspace_id)
    }

    /// Retrieves a workspace by ID (mutable access for modifications)
    fn get_workspace_mut(&mut self, workspace_id: &str) -> Option<&mut Workspace> {
        self.get_workspace_mut_internal(workspace_id)
    }

    /// Returns all workspaces in the system
    fn get_all_workspaces(&self) -> &std::collections::HashMap<String, Workspace> {
        self.get_all_workspaces_internal()
    }

    /// Inserts a new workspace into the system
    fn insert_workspace(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.insert_workspace_internal(workspace_id, workspace)
    }

    /// Updates an existing workspace's properties
    fn update_workspace(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.update_workspace_internal(workspace_id, new_workspace)
    }

    /// Removes a workspace from the system
    fn remove_workspace(&mut self, workspace_id: &str) -> Result<Option<Workspace>, NetworkError> {
        self.remove_workspace_internal(workspace_id)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // DOMAIN OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a domain entity by ID (read-only access)
    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.get_domain_internal(domain_id)
    }

    /// Retrieves a domain entity by ID (mutable access for modifications)
    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain> {
        self.get_domain_mut_internal(domain_id)
    }

    /// Returns all domain entities in the system
    fn get_all_domains(&self) -> Result<Vec<(String, Domain)>, NetworkError> {
        self.get_all_domains_internal()
    }

    /// Inserts a new domain entity into the system
    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.insert_domain_internal(domain_id, domain)
    }

    /// Updates an existing domain entity's properties
    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        self.update_domain_internal(domain_id, new_domain)
    }

    /// Removes a domain entity from the system
    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.remove_domain_internal(domain_id)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // USER OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a user account by ID (read-only access)
    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.get_user_internal(user_id)
    }

    /// Retrieves a user account by ID (mutable access for modifications)
    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.get_user_mut_internal(user_id)
    }

    /// Returns all user accounts in the system
    fn get_all_users(&self) -> &std::collections::HashMap<String, User> {
        self.get_all_users_internal()
    }

    /// Inserts a new user account into the system
    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.insert_user_internal(user_id, user)
    }

    /// Updates an existing user account's properties
    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError> {
        self.update_user_internal(user_id, new_user)
    }

    /// Removes a user account from the system
    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.remove_user_internal(user_id)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // DOMAIN-USER RELATIONSHIP OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Checks if a user is a member of a specific domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        self.is_member_of_domain_internal(user_id, domain_id)
    }

    /// Adds a user to a domain with the specified role
    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.add_user_to_domain_internal(user_id, domain_id, role)
    }

    /// Removes a user from a domain
    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_user_from_domain_internal(user_id, domain_id)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // ROLE AND PERMISSION OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a user's role in the system
    fn get_user_role(&self, user_id: &str) -> Result<Option<UserRole>, NetworkError> {
        self.get_user_role_internal(user_id)
    }

    /// Retrieves all permissions granted to a user
    fn get_permissions(&self, user_id: &str) -> Result<Vec<Permission>, NetworkError> {
        self.get_permissions_internal(user_id, None)
    }

    /// Retrieves a role definition by ID
    fn get_role(&self, role_id: &str) -> Result<Option<UserRole>, NetworkError> {
        self.get_role_internal(role_id)
    }

    /// Creates a new role definition in the system
    fn create_role(&mut self, role: UserRole) -> Result<(), NetworkError> {
        self.create_role_internal(role)
    }

    /// Deletes a role definition from the system
    fn delete_role(&mut self, role_id: &str) -> Result<(), NetworkError> {
        self.delete_role_internal(role_id)
    }

    /// Assigns a role to a user
    fn assign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError> {
        self.assign_role_internal(user_id, role_id)
    }

    /// Removes a role assignment from a user
    fn unassign_role(&mut self, user_id: &str, role_id: &str) -> Result<(), NetworkError> {
        self.unassign_role_internal(user_id, role_id)
    }

    // ────────────────────────────────────────────────────────────────────────────
    // TRANSACTION COMMIT OPERATION
    // ────────────────────────────────────────────────────────────────────────────

    /// Commits all transaction changes to the persistent database
    fn commit(&self) -> Result<(), NetworkError> {
        self.commit_internal()
    }
}
