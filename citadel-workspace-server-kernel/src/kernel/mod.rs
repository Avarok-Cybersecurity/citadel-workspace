// Core kernel modules for workspace server functionality
//
// This module has been refactored from a single 469-line file into focused submodules
// to improve maintainability and code organization. Each module has a specific responsibility:
//
// - `core`: Core struct definition, basic implementations, and constructors
// - `network`: NetKernel trait implementation for network operations
// - `initialization`: Admin setup and workspace initialization logic
// - `user_management`: User injection utilities for testing
// - `member_operations`: Domain member add/remove operations

/// Whether a session may be sent a broadcast.
mod broadcast_scope;
pub mod command_processor;
pub mod display_name;
/// The Documents relay: configuration and the log's rules.
pub mod documents;
pub mod group_access;
pub mod ice_servers;
/// A usage limit as the host states it: a count, or explicitly none.
pub mod limit;
pub mod profile_limits;
pub mod profile_update;
pub mod profile_visibility;
pub mod rate_limiter;
/// Edits to a workspace's role table, and the rules they obey. Pure.
pub mod role_edits;
pub(crate) mod roster;
pub mod secret_eq;
/// Secure links: tokens the server maps to in-app deep links.
pub mod secure_links;
/// What the server advertises, derived from the backend it runs on.
pub mod server_capabilities;
pub mod sign_in;
pub mod telemetry;
pub mod transaction;
pub mod tree_schema_migration;
pub(crate) mod trust_scope;
#[cfg(test)]
mod trust_scope_tests;

// Import focused kernel modules - commented out old sync code
pub mod async_kernel;

// Re-export main types and traits for backward compatibility
// pub use core::{MemberAction, WorkspaceServerKernel};

// The NetKernel trait implementation is automatically available when importing WorkspaceServerKernel
// All other methods (new, with_admin, inject_admin_user, etc.) are also automatically available
// as they are implemented in the respective modules via `impl<R: Ratchet> WorkspaceServerKernel<R>`
