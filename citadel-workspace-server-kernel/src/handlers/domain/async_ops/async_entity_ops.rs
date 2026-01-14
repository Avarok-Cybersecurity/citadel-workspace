//! # Async Entity Operations Module
//!
//! This module provides async generic entity operations

use crate::handlers::domain::core::DomainEntity;
use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// Async generic entity operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncEntityOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Retrieves a domain entity with type safety
    async fn get_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;

    /// Creates a new domain entity with type safety
    async fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned + Send>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>;

    /// Deletes a domain entity with proper cleanup
    async fn delete_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;

    /// Updates properties of a domain entity
    async fn update_domain_entity<T: DomainEntity + 'static + Send>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>;

    /// Lists domain entities of a specific type with optional parent filtering
    async fn list_domain_entities<T: DomainEntity + 'static + Send>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>;
}
