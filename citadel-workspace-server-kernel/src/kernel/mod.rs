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

pub mod command_processor;
pub mod transaction;

// Import focused kernel modules
pub mod core;
pub mod network;
pub mod initialization;
pub mod user_management;
pub mod member_operations;

// Re-export main types and traits for backward compatibility
pub use core::{MemberAction, WorkspaceServerKernel};

// The NetKernel trait implementation is automatically available when importing WorkspaceServerKernel
// All other methods (new, with_admin, inject_admin_user, etc.) are also automatically available
// as they are implemented in the respective modules via `impl<R: Ratchet> WorkspaceServerKernel<R>`
