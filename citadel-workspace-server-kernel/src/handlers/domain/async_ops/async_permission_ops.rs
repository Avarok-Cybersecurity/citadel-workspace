//! # Async Permission Operations Module
//!
//! This module provides async permission and authorization operations

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;

/// Async permission and authorization operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncPermissionOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Checks if a user has a specific permission for an entity
    async fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError>;

    /// Checks if a user is a member of a specific domain
    async fn is_member_of_domain(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError>;
}
