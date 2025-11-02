//! # Async User Management Operations Module
//!
//! This module provides async user management operations

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Permission, UserRole};
use citadel_workspace_types::UpdateOperation;

/// Async user management operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncUserManagementOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Adds a user to a domain with the specified role
    async fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Removes a user from a domain and revokes all associated permissions
    async fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError>;

    /// Updates a user's role within a workspace
    async fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError>;

    /// Updates a user's specific permissions in a domain
    async fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError>;
}
