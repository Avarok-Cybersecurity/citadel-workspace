//! # Domain Operations Module
//!
//! This module provides the core domain management framework for the workspace system.
//! It defines traits and utilities for managing domain entities (workspaces, offices, rooms)
//! and their associated operations including CRUD, permissions, and member management.
//!
//! ## Architecture Overview
//!
//! The domain module is organized into focused sub-modules:
//! - **`core`**: Base traits and utility functions
//! - **`operations_trait`**: Main domain operations trait definition
//! - **`transaction_ops`**: Transaction management operations
//! - **`permission_ops`**: Permission and authorization operations
//! - **`user_ops`**: User management operations
//! - **`entity_ops`**: Generic entity CRUD operations
//! - **`workspace_ops`**: Workspace-specific operations
//! - **`office_ops`**: Office-specific operations
//! - **`room_ops`**: Room-specific operations
//!
//! ## Key Components
//!
//! ### Domain Entity Framework
//! - **`DomainEntity`**: Core trait for all domain entities with common operations
//! - **Domain Operations**: Comprehensive trait defining all domain-level operations
//! - **Permission System Integration**: Seamless integration with role-based access control
//!
//! ### Entity Types Supported
//! - **Workspaces**: Top-level organizational units with master password protection
//! - **Offices**: Sub-units within workspaces for team organization  
//! - **Rooms**: Collaboration spaces within offices for specific projects/topics
//! - **Users**: Member entities with roles and permissions across domains

use citadel_sdk::prelude::Ratchet;

// ═══════════════════════════════════════════════════════════════════════════════════
// MODULE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════════

pub mod core;
pub mod entity_ops;
pub mod office_ops;
pub mod operations_trait;
pub mod room_ops;
pub mod user_ops;

// Async operations module
pub mod async_ops;

// Legacy module structure (preserved for compatibility)
pub mod entity;
pub mod server_ops;

// ═══════════════════════════════════════════════════════════════════════════════════
// RE-EXPORTS FOR PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════════

// Core components
pub use core::{permission_denied, DomainEntity};

// Main trait definitions
pub use entity_ops::EntityOperations;
pub use office_ops::OfficeOperations;
pub use operations_trait::DomainOperations;
pub use room_ops::RoomOperations;
pub use user_ops::UserManagementOperations;

// ═══════════════════════════════════════════════════════════════════════════════════
// UNIFIED DOMAIN OPERATIONS TRAIT
// ═══════════════════════════════════════════════════════════════════════════════════

/// Unified trait that combines all domain operation categories.
///
/// This trait provides a single interface that includes all domain operations,
/// making it easy to implement comprehensive domain functionality in one place.
/// Implementors automatically get access to all operation categories.
///
/// ## Usage
///
/// Implement this trait to provide complete domain functionality:
///
/// ```rust,ignore
/// impl<R: Ratchet + Send + Sync + 'static> CompleteDomainOperations<R> for MyDomainService {
///     // Implement all required methods from constituent traits
/// }
/// ```
#[auto_impl::auto_impl(Arc)]
pub trait CompleteDomainOperations<R: Ratchet + Send + Sync + 'static>:
    DomainOperations<R>
    + UserManagementOperations<R>
    + EntityOperations<R>
    + OfficeOperations<R>
    + RoomOperations<R>
{
    // This trait automatically combines all operation categories
    // No additional methods needed - all functionality comes from constituent traits
}
