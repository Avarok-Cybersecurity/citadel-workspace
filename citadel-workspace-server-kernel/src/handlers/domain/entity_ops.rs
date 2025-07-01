//! # Entity Operations Module
//!
//! This module defines generic entity operations for the domain system,
//! providing type-safe CRUD operations that work with any domain entity type.

use crate::handlers::domain::core::DomainEntity;
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// Generic entity operations for the domain operations trait.
///
/// This module provides extension methods for generic CRUD operations
/// that work with any type implementing the DomainEntity trait.
pub trait EntityOperations<R: Ratchet + Send + Sync + 'static> {
    // ────────────────────────────────────────────────────────────────────────────
    // GENERIC DOMAIN ENTITY OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a domain entity with type safety.
    ///
    /// This generic method allows retrieval of any domain entity type
    /// with compile-time type safety and automatic conversion from the
    /// underlying storage representation.
    ///
    /// # Type Parameters
    /// * `T` - The specific domain entity type to retrieve
    ///
    /// # Arguments
    /// * `user_id` - ID of the user requesting the entity (for permission checking)
    /// * `entity_id` - ID of the entity to retrieve
    ///
    /// # Returns
    /// * `Ok(T)` - Entity successfully retrieved and converted
    /// * `Err(NetworkError)` - Retrieval failed due to permissions, not found, or type mismatch
    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;

    /// Creates a new domain entity with type safety.
    ///
    /// This generic method allows creation of any domain entity type
    /// with proper validation, permission checking, and initialization.
    ///
    /// # Type Parameters
    /// * `T` - The specific domain entity type to create
    ///
    /// # Arguments
    /// * `user_id` - ID of the user creating the entity
    /// * `parent_id` - Optional parent entity for hierarchical relationships
    /// * `name` - Display name for the new entity
    /// * `description` - Detailed description of the entity
    /// * `mdx_content` - Optional MDX content for rich documentation
    ///
    /// # Returns
    /// * `Ok(T)` - Entity successfully created
    /// * `Err(NetworkError)` - Creation failed due to permissions, validation, or system error
    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>;

    /// Deletes a domain entity with proper cleanup.
    ///
    /// This generic method handles deletion of any domain entity type
    /// with cascading cleanup of related entities and proper permission validation.
    ///
    /// # Type Parameters
    /// * `T` - The specific domain entity type to delete
    ///
    /// # Arguments
    /// * `user_id` - ID of the user deleting the entity
    /// * `entity_id` - ID of the entity to delete
    ///
    /// # Returns
    /// * `Ok(T)` - Entity successfully deleted (returns deleted entity)
    /// * `Err(NetworkError)` - Deletion failed due to permissions or system error
    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError>;

    /// Updates properties of a domain entity.
    ///
    /// This generic method allows updating common properties of any domain
    /// entity type with proper validation and permission checking.
    ///
    /// # Type Parameters
    /// * `T` - The specific domain entity type to update
    ///
    /// # Arguments
    /// * `user_id` - ID of the user updating the entity
    /// * `domain_id` - ID of the entity to update
    /// * `name` - Optional new name for the entity
    /// * `description` - Optional new description for the entity
    /// * `mdx_content` - Optional new MDX content for the entity
    ///
    /// # Returns
    /// * `Ok(T)` - Entity successfully updated
    /// * `Err(NetworkError)` - Update failed due to permissions or system error
    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>;

    /// Lists domain entities of a specific type with optional parent filtering.
    ///
    /// This generic method provides type-safe listing of domain entities
    /// with proper permission filtering and optional parent-child relationships.
    ///
    /// # Type Parameters
    /// * `T` - The specific domain entity type to list
    ///
    /// # Arguments
    /// * `user_id` - ID of the user requesting the list
    /// * `parent_id` - Optional parent entity ID to filter by
    ///
    /// # Returns
    /// * `Ok(Vec<T>)` - List of accessible entities of the specified type
    /// * `Err(NetworkError)` - Listing failed due to system error
    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>;
}
