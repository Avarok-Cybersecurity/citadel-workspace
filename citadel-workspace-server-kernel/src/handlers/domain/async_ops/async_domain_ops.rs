//! # Async Domain Operations Trait
//!
//! This module provides the async version of the DomainOperations trait

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, User};

/// Async version of DomainOperations trait
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncDomainOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Initializes the domain operations system
    async fn init(&self) -> Result<(), NetworkError>;

    /// Checks if a user has administrative privileges
    async fn is_admin(&self, user_id: &str) -> Result<bool, NetworkError>;

    /// Retrieves a user entity by their unique identifier
    async fn get_user(&self, user_id: &str) -> Result<Option<User>, NetworkError>;

    /// Retrieves a domain entity by its unique identifier
    async fn get_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError>;
}
