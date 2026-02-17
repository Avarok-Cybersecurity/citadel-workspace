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
