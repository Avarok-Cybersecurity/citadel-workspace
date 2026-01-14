//! # User Management Operations Module
//!
//! This module defines user management operations for the domain system,
//! providing functionality for adding, removing, and updating user roles and permissions.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;

/// User management operations for the domain operations trait.
///
/// This module provides extension methods for managing domain users,
/// including role assignments, permission updates, and membership management.
pub trait UserManagementOperations<R: Ratchet + Send + Sync + 'static> {
    // ────────────────────────────────────────────────────────────────────────────
    // USER MANAGEMENT OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Adds a user to a domain with the specified role.
    ///
    /// This operation grants domain membership and assigns initial permissions
    /// based on the specified role. Requires admin privileges or appropriate
    /// management permissions in the target domain.
    ///
    /// # Arguments
    /// * `admin_id` - ID of the user performing the addition (must have admin/management rights)
    /// * `user_id_to_add` - ID of the user to add to the domain
    /// * `domain_id` - ID of the domain to add the user to
    /// * `role` - Role to assign to the user in the domain
    ///
    /// # Returns
    /// * `Ok(())` - User successfully added to domain
    /// * `Err(NetworkError)` - Addition failed due to permissions or system error
    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Removes a user from a domain and revokes all associated permissions.
    ///
    /// This operation removes domain membership and all associated permissions.
    /// Requires admin privileges or appropriate management permissions in the target domain.
    ///
    /// # Arguments
    /// * `admin_id` - ID of the user performing the removal (must have admin/management rights)
    /// * `user_id_to_remove` - ID of the user to remove from the domain
    /// * `domain_id` - ID of the domain to remove the user from
    ///
    /// # Returns
    /// * `Ok(())` - User successfully removed from domain
    /// * `Err(NetworkError)` - Removal failed due to permissions or system error
    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError>;

    /// Updates a user's role within a workspace.
    ///
    /// This operation modifies the user's role and associated permissions
    /// within a workspace context. Role changes affect permission inheritance
    /// and access to workspace operations.
    ///
    /// # Arguments
    /// * `actor_user_id` - ID of the user performing the role update
    /// * `target_user_id` - ID of the user whose role is being updated
    /// * `role` - New role to assign to the target user
    /// * `metadata` - Optional metadata for role-specific features
    ///
    /// # Returns
    /// * `Ok(())` - Role successfully updated
    /// * `Err(NetworkError)` - Update failed due to permissions or system error
    fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>, // metadata might be used later for specific role features
    ) -> Result<(), NetworkError>;

    /// Updates a user's specific permissions in a domain.
    ///
    /// This operation allows fine-grained permission management, adding or
    /// removing specific permissions beyond what's granted by roles.
    ///
    /// # Arguments
    /// * `actor_user_id` - ID of the user performing the permission update
    /// * `target_user_id` - ID of the user whose permissions are being updated
    /// * `domain_id` - ID of the domain where permissions are being modified
    /// * `permissions` - List of permissions to add or remove
    /// * `operation` - Whether to add or remove the specified permissions
    ///
    /// # Returns
    /// * `Ok(())` - Permissions successfully updated
    /// * `Err(NetworkError)` - Update failed due to permissions or system error
    fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError>;
}
