//! # Domain Core Module
//!
//! This module provides the foundational components for the domain management system,
//! including utility functions and the base domain entity trait that all domain
//! entities must implement.

use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, Office, Room, Workspace};

// ═══════════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════

/// Creates a standardized permission denied error with consistent formatting.
///
/// This utility function provides a centralized way to generate permission denied
/// errors throughout the domain operations, ensuring consistent error messages
/// and proper error type handling.
///
/// # Arguments
/// * `msg` - The specific permission denial message to include
///
/// # Returns
/// * `NetworkError` - Formatted permission denied error
pub fn permission_denied<S: std::fmt::Display>(msg: S) -> NetworkError {
    NetworkError::msg(format!("Permission denied: {msg}"))
}

// ═══════════════════════════════════════════════════════════════════════════════════
// DOMAIN ENTITY TRAIT DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════════

/// Core trait for entities that belong to a domain in the workspace system.
///
/// This trait provides the foundational interface that all domain entities
/// (workspaces, offices, rooms) must implement. It ensures consistent behavior
/// across different entity types and enables generic operations.
///
/// ## Required Capabilities
/// - **Identity**: Unique identification and naming
/// - **Ownership**: Clear ownership and domain association
/// - **Serialization**: Conversion to/from domain enum representations
/// - **Creation**: Standardized entity creation pattern
///
/// ## Thread Safety
/// All implementors must be `Clone + Send + Sync + 'static` to support
/// concurrent access in the multi-threaded server environment.
pub trait DomainEntity: Clone + Send + Sync + 'static {
    /// Returns the unique identifier for this entity
    fn id(&self) -> String;

    /// Returns the display name for this entity
    fn name(&self) -> String;

    /// Returns the detailed description of this entity
    fn description(&self) -> String;

    /// Returns the ID of the user who owns this entity
    fn owner_id(&self) -> String;

    /// Returns the ID of the domain this entity belongs to
    fn domain_id(&self) -> String;

    /// Returns the entity type as a string ("workspace", "office", "room")
    fn entity_type() -> &'static str
    where
        Self: Sized;

    /// Converts this entity into its corresponding Domain enum variant.
    ///
    /// This method enables type-safe conversion from concrete entity types
    /// to the unified Domain enum used for storage and serialization.
    fn into_domain(self) -> Domain
    where
        Self: Sized;

    /// Creates a new entity instance with the specified parameters.
    ///
    /// This factory method provides a standardized way to create new entities
    /// with consistent initialization patterns across all domain entity types.
    ///
    /// # Arguments
    /// * `id` - Unique identifier for the new entity
    /// * `parent_id` - Optional parent entity ID for hierarchical relationships
    /// * `name` - Display name for the entity
    /// * `description` - Detailed description of the entity
    fn create(id: String, parent_id: Option<String>, name: &str, description: &str) -> Self
    where
        Self: Sized;

    /// Extracts an entity from a Domain enum variant.
    ///
    /// This method enables type-safe extraction of concrete entity types
    /// from the unified Domain enum, returning None if the enum variant
    /// doesn't match the expected entity type.
    ///
    /// # Arguments
    /// * `domain` - Domain enum instance to extract from
    ///
    /// # Returns
    /// * `Some(Self)` - Successfully extracted entity
    /// * `None` - Domain variant doesn't match this entity type
    fn from_domain(domain: Domain) -> Option<Self>
    where
        Self: Sized;

    /// Attempts to convert from a Workspace entity.
    ///
    /// # Arguments
    /// * `workspace` - Workspace entity to convert
    ///
    /// # Returns
    /// * `Ok(Self)` - Successfully converted entity
    /// * `Err(NetworkError)` - Conversion failed (entity type mismatch)
    fn try_from_workspace(workspace: Workspace) -> Result<Self, NetworkError>
    where
        Self: Sized;

    /// Attempts to convert from an Office entity.
    ///
    /// # Arguments
    /// * `office` - Office entity to convert
    ///
    /// # Returns
    /// * `Ok(Self)` - Successfully converted entity
    /// * `Err(NetworkError)` - Conversion failed (entity type mismatch)
    fn try_from_office(office: Office) -> Result<Self, NetworkError>
    where
        Self: Sized;

    /// Attempts to convert from a Room entity.
    ///
    /// # Arguments
    /// * `room` - Room entity to convert
    ///
    /// # Returns
    /// * `Ok(Self)` - Successfully converted entity
    /// * `Err(NetworkError)` - Conversion failed (entity type mismatch)
    fn try_from_room(room: Room) -> Result<Self, NetworkError>
    where
        Self: Sized;
}
