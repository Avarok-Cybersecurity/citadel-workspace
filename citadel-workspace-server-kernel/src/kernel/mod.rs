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

/// Citadel Apps: the pure install, grant and audience rules.
pub mod apps;
/// Whether a session may be sent a broadcast.
mod broadcast_scope;
/// Reclaiming the space node chat files no longer need, on upload and on the host's timer.
pub mod chat_attachment_sweep;
pub mod chat_attachments;
#[cfg(test)]
mod chat_attachments_tests;
pub mod chat_document_limit;
/// Which account each live connection belongs to.
mod cid_attribution;
pub mod command_processor;
/// Giving the root workspace its default app tabs when it has none.
mod default_tabs_provisioning;
pub mod display_name;
/// The Documents relay: configuration and the log's rules.
pub mod documents;
pub mod group_access;
pub mod group_chat_gates;
pub mod ice_servers;
/// Verifying an `UpdateUserProfile.identity_binding` before it is stored.
pub mod identity_binding;
/// A usage limit as the host states it: a count, or explicitly none.
pub mod limit;
pub mod profile_limits;
pub mod profile_update;
#[cfg(test)]
mod profile_update_tests;
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
/// The server's canonical domain, key, identity challenge and `/.well-known/citadel`.
pub mod server_identity;
pub mod sign_in;
pub mod telemetry;
pub mod transaction;
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
