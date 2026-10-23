//! # Command Processor Module
//!
//! This module provides the central command processing engine for the workspace server kernel.
//! It handles all incoming `WorkspaceProtocolRequest` commands and routes them to appropriate
//! domain operations, returning standardized `WorkspaceProtocolResponse` results.
//!
//! ## Architecture Overview
//!
//! ### Command Processing Pipeline
//! The command processor follows a structured pipeline:
//! 1. **Request Validation**: Validate incoming command structure and parameters
//! 2. **Permission Checking**: Verify user has required permissions for the operation
//! 3. **Domain Operation**: Execute the requested operation via domain operations
//! 4. **Response Formatting**: Convert results to standardized protocol responses
//! 5. **Error Handling**: Standardized error handling with logging and user-friendly messages
//!
//! ### Command Categories
//! - **Workspace Commands**: Core workspace lifecycle management (create, read, update, delete)
//! - **Node Commands**: Generic tree node CRUD (offices, rooms, custom types)
//! - **Member Commands**: User management and permission operations across all entity types
//!
//! ## Error Handling Strategy
//! All operations use a consistent error handling pattern that:
//! - Logs detailed error information for debugging
//! - Returns user-friendly error messages in protocol responses
//! - Maintains operation atomicity through proper transaction management
//! - Provides specific error context for different failure scenarios

// ═══════════════════════════════════════════════════════════════════════════════════
// SUBMODULE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════════

/// Async command processor
pub mod async_process_command;

/// What a failed workspace lookup means, decided from facts rather than prose.
pub mod workspace_lookup;

/// UpdateWorkspaceProfile: name, description and icon.
mod workspace_profile;

/// What a workspace icon may be.
pub mod workspace_logo;

/// The one read-modify-write for a stored workspace record.
pub(crate) mod workspace_record;

/// "Members can see each other": SetMembersVisible, and the rule ListMembers reads.
mod members_visibility;

/// Terms, consent and the Telemetry Service.
mod telemetry;

/// Who connects without asking: the workspace's policy, a member's own, and the check.
mod messaging_trust;

/// The workspace's role table: list, create, edit, delete.
mod roles;

/// A document node's update log, snapshot and awareness relay.
mod documents;
/// Secure links: create, list, delete, regenerate, extend, resolve.
mod secure_links;

/// Opening a secure link: the grant check and the one-time burn.
mod secure_links_resolve;

/// A secure link's owner listing, deleting, regenerating and extending it.
mod secure_links_owner;

/// Citadel Apps: the registry, installs, their artifacts and the audit log.
mod apps;
/// `Call`: a running app's host call, re-checked, served from storage or server egress.
mod apps_call;
/// `storage.blob`, which `Call` serves.
mod apps_call_blob;
/// The storage backends `Call` serves.
mod apps_call_storage;
/// The reads the apps decisions need, made before they decide, and what an install may do now.
pub mod apps_gather;
/// The kernel's own writes to a document's required-apps header.
mod apps_header;
/// `AdvertiseService` and `IhttpSend`: internal HTTP relayed between sessions.
mod apps_ihttp;
/// `WithdrawService`, and an install's relay state ending with its release.
mod apps_ihttp_end;
/// Which install an internal-HTTP request is for.
mod apps_ihttp_target;
/// `Install`.
mod apps_install;
/// `Uninstall` and `Rollback`.
mod apps_lifecycle;
/// The registry: listing, reading, publishing, uploading.
mod apps_listing;
/// What a member reads about the installs that concern them.
mod apps_member;
/// Where a listing and its artifact come from.
mod apps_offer;
mod apps_peer;
mod apps_peer_topic;
/// `Update` and `Consent`.
mod apps_update;
/// `UploadArtifactChunk`.
mod apps_upload;
