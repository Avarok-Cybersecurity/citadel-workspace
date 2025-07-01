//! # Permission Operations Module
//!
//! This module defines permission and authorization operations for the domain system,
//! providing comprehensive access control and membership management.

use crate::kernel::transaction::Transaction;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;

/// Permission and authorization operations for the domain operations trait.
///
/// This module provides extension methods for handling permission checks,
/// domain membership validation, and authorization throughout the system.
pub trait PermissionOperations<R: Ratchet + Send + Sync + 'static> {
    // ────────────────────────────────────────────────────────────────────────────
    // PERMISSION AND AUTHORIZATION OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Checks if a user has a specific permission for an entity.
    ///
    /// This method performs comprehensive authorization checking including
    /// direct permissions, inherited permissions, and role-based access.
    ///
    /// # Arguments
    /// * `tx` - Read transaction for database access
    /// * `user_id` - ID of the user to check permissions for
    /// * `entity_id` - ID of the entity to check permissions on
    /// * `permission` - Specific permission to validate
    ///
    /// # Returns
    /// * `Ok(true)` - User has the specified permission
    /// * `Ok(false)` - User does not have the specified permission
    /// * `Err(NetworkError)` - Permission check failed due to system error
    fn check_entity_permission(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError>;

    /// Checks if a user is a member of a specific domain.
    ///
    /// Domain membership is the foundation for all permission checks and
    /// determines basic access rights to domain entities and operations.
    ///
    /// # Arguments
    /// * `tx` - Read transaction for database access
    /// * `user_id` - ID of the user to check membership for
    /// * `domain_id` - ID of the domain to check membership in
    ///
    /// # Returns
    /// * `Ok(true)` - User is a member of the domain
    /// * `Ok(false)` - User is not a member of the domain
    /// * `Err(NetworkError)` - Membership check failed due to system error
    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError>;
}
