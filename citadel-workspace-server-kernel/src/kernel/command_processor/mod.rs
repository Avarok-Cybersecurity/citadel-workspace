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
//! - **Office Commands**: Office management within workspaces
//! - **Room Commands**: Room management within offices
//! - **Member Commands**: User management and permission operations across all entity types
//!
//! ## Error Handling Strategy
//! All operations use a consistent error handling pattern that:
//! - Logs detailed error information for debugging
//! - Returns user-friendly error messages in protocol responses
//! - Maintains operation atomicity through proper transaction management
//! - Provides specific error context for different failure scenarios

use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};

// ═══════════════════════════════════════════════════════════════════════════════════
// SUBMODULE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════════════════════

/// Member-specific command implementations and utilities
mod member_commands;

/// Office-specific command implementations and utilities  
mod office_commands;

/// Room-specific command implementations and utilities
mod room_commands;

/// Workspace-specific command implementations and utilities
mod workspace_commands;

// ═══════════════════════════════════════════════════════════════════════════════════
// CORE COMMAND PROCESSING IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════════

impl<R: Ratchet> WorkspaceServerKernel<R> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // UTILITY FUNCTIONS
    // ────────────────────────────────────────────────────────────────────────────
    
    /// Standardized result handling for all command operations.
    ///
    /// This helper function provides consistent error handling across all command types,
    /// ensuring that successful operations are properly formatted and errors are logged
    /// with appropriate context while returning user-friendly error messages.
    ///
    /// # Type Parameters
    /// * `T` - The successful result type from the domain operation
    /// * `F` - Function type for converting successful results to protocol responses
    ///
    /// # Arguments
    /// * `result` - Result from the domain operation (success or error)
    /// * `success_mapper` - Function to convert successful results to protocol responses
    /// * `error_msg_prefix` - Prefix for error messages to provide operation context
    ///
    /// # Returns
    /// * `Ok(WorkspaceProtocolResponse)` - Always returns Ok with either success response or error response
    /// * `Err(NetworkError)` - Only in rare system-level failures
    ///
    /// # Error Handling Strategy
    /// - Successful operations are mapped using the provided success_mapper function
    /// - Failed operations are logged with full error details for debugging
    /// - User-facing error responses contain the error_msg_prefix plus sanitized error info
    /// - All errors are converted to WorkspaceProtocolResponse::Error for consistent client handling
    pub(crate) fn handle_result<T, F>(
        result: Result<T, NetworkError>,
        success_mapper: F,
        error_msg_prefix: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError>
    where
        F: FnOnce(T) -> WorkspaceProtocolResponse,
    {
        match result {
            Ok(val) => Ok(success_mapper(val)),
            Err(e) => {
                let full_error_msg = format!("{}: {}", error_msg_prefix, e);
                error!("{}", full_error_msg);
                Ok(WorkspaceProtocolResponse::Error(full_error_msg))
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // MAIN COMMAND PROCESSOR
    // ────────────────────────────────────────────────────────────────────────────

    /// Processes incoming workspace protocol commands and returns appropriate responses.
    ///
    /// This is the central command processing function that handles all supported
    /// `WorkspaceProtocolRequest` commands. It serves as the main entry point for
    /// all client operations and provides unified command routing, validation,
    /// and response formatting.
    ///
    /// # Arguments
    /// * `actor_user_id` - ID of the user performing the command (for permission validation)
    /// * `command` - The specific workspace protocol command to process
    ///
    /// # Returns
    /// * `Ok(WorkspaceProtocolResponse)` - Successfully processed command with appropriate response
    /// * `Err(NetworkError)` - System-level error in command processing
    ///
    /// # Command Categories Supported
    /// - **Workspace Operations**: Load, create, get, update, delete workspaces
    /// - **Office Operations**: Create, get, delete, update, list offices
    /// - **Room Operations**: Create, get, delete, update, list rooms  
    /// - **Member Operations**: Get, add, remove, update roles/permissions, list members
    ///
    /// # Permission Model
    /// All commands include automatic permission validation based on:
    /// - User identity and role within relevant domains
    /// - Specific permission requirements for each operation type
    /// - Hierarchical permission inheritance (workspace → office → room)
    /// - Master password requirements for sensitive workspace operations
    ///
    /// # Error Handling
    /// - Invalid commands return descriptive error responses
    /// - Permission failures return permission denied messages
    /// - System errors are logged and return sanitized error responses
    /// - All errors maintain user session and don't cause disconnection
    pub fn process_command(
        &self,
        actor_user_id: &str,
        command: WorkspaceProtocolRequest,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        println!(
            "[PROCESS_COMMAND_ENTRY] actor_user_id: {}, command: {:?}",
            actor_user_id, command
        );
        let resp = match command {
            // ════════════════════════════════════════════════════════════════════
            // UNSUPPORTED COMMAND TYPES
            // ════════════════════════════════════════════════════════════════════
            
            WorkspaceProtocolRequest::Message { .. } => {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Message command is not supported by server. Only peers may receive this type"
                        .to_string(),
                ))
            }

            // ════════════════════════════════════════════════════════════════════
            // WORKSPACE COMMANDS
            // ════════════════════════════════════════════════════════════════════
            
            /// Load the primary workspace for the requesting user
            WorkspaceProtocolRequest::LoadWorkspace => Self::handle_result(
                self.load_workspace(actor_user_id, None),
                WorkspaceProtocolResponse::Workspace,
                "Failed to load workspace",
            ),
            
            /// Create a new workspace with master password protection
            WorkspaceProtocolRequest::CreateWorkspace {
                name,
                description,
                metadata,
                workspace_master_password,
            } => Self::handle_result(
                self.create_workspace(
                    actor_user_id,
                    &name,
                    &description,
                    metadata,
                    workspace_master_password,
                ),
                WorkspaceProtocolResponse::Workspace,
                "Failed to create workspace",
            ),
            
            /// Retrieve workspace details for the root workspace
            WorkspaceProtocolRequest::GetWorkspace => Self::handle_result(
                self.get_workspace(actor_user_id, crate::WORKSPACE_ROOT_ID),
                WorkspaceProtocolResponse::Workspace,
                "Failed to get workspace",
            ),
            
            /// Update workspace properties with master password verification
            WorkspaceProtocolRequest::UpdateWorkspace {
                name,
                description,
                metadata,
                workspace_master_password,
            } => Self::handle_result(
                self.update_workspace(
                    actor_user_id,
                    crate::WORKSPACE_ROOT_ID,
                    name.as_deref(),
                    description.as_deref(),
                    metadata,
                    workspace_master_password,
                ),
                WorkspaceProtocolResponse::Workspace,
                "Failed to update workspace",
            ),
            
            /// Delete workspace with master password verification and cascading cleanup
            WorkspaceProtocolRequest::DeleteWorkspace {
                workspace_master_password,
            } => Self::handle_result(
                self.delete_workspace(actor_user_id, workspace_master_password),
                |_| {
                    WorkspaceProtocolResponse::Success("Workspace deleted successfully".to_string())
                },
                "Failed to delete workspace",
            ),

            // ════════════════════════════════════════════════════════════════════
            // OFFICE COMMANDS
            // ════════════════════════════════════════════════════════════════════
            
            /// Create a new office within the specified workspace
            WorkspaceProtocolRequest::CreateOffice {
                workspace_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.domain_ops().create_office(
                    actor_user_id,
                    &workspace_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Office,
                "Failed to create office",
            ),
            
            /// Retrieve office details by ID with permission validation
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.get_office_command_internal(actor_user_id, &office_id),
                |response| response,
                "Failed to get office",
            ),
            
            /// Delete office and all associated rooms with cascading cleanup
            WorkspaceProtocolRequest::DeleteOffice { office_id } => Self::handle_result(
                self.domain_ops().delete_office(actor_user_id, &office_id),
                |_| WorkspaceProtocolResponse::Success("Office deleted successfully".to_string()),
                "Failed to delete office",
            ),
            
            /// Update office properties (name, description, MDX content)
            WorkspaceProtocolRequest::UpdateOffice {
                office_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.update_office_command_internal(
                    actor_user_id,
                    &office_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Office,
                "Failed to update office",
            ),
            
            /// List all offices accessible to the requesting user
            WorkspaceProtocolRequest::ListOffices => Self::handle_result(
                self.domain_ops().list_offices(actor_user_id, None),
                WorkspaceProtocolResponse::Offices,
                "Failed to list offices",
            ),

            // ════════════════════════════════════════════════════════════════════
            // ROOM COMMANDS
            // ════════════════════════════════════════════════════════════════════
            
            /// Create a new room within the specified office
            WorkspaceProtocolRequest::CreateRoom {
                office_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.domain_ops().create_room(
                    actor_user_id,
                    &office_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Room,
                "Failed to create room",
            ),
            
            /// Retrieve room details by ID with permission validation
            WorkspaceProtocolRequest::GetRoom { room_id } => Self::handle_result(
                self.domain_ops().get_room(actor_user_id, &room_id),
                WorkspaceProtocolResponse::Room,
                "Failed to get room",
            ),
            
            /// Delete room and remove from parent office
            WorkspaceProtocolRequest::DeleteRoom { room_id } => Self::handle_result(
                self.domain_ops().delete_room(actor_user_id, &room_id),
                |_| WorkspaceProtocolResponse::Success("Room deleted successfully".to_string()),
                "Failed to delete room",
            ),
            
            /// Update room properties (name, description, MDX content)
            WorkspaceProtocolRequest::UpdateRoom {
                room_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.update_room_command_internal(
                    actor_user_id,
                    &room_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Room,
                "Failed to update room",
            ),
            
            /// List all rooms in the specified office accessible to the requesting user
            WorkspaceProtocolRequest::ListRooms { office_id } => Self::handle_result(
                self.domain_ops().list_rooms(actor_user_id, Some(office_id)),
                WorkspaceProtocolResponse::Rooms,
                "Failed to list rooms",
            ),

            // ════════════════════════════════════════════════════════════════════
            // MEMBER MANAGEMENT COMMANDS
            // ════════════════════════════════════════════════════════════════════
            
            /// Retrieve member details and permissions by user ID
            WorkspaceProtocolRequest::GetMember { user_id } => Self::handle_result(
                self.get_member_command_internal(actor_user_id, &user_id),
                |response| response,
                "Failed to get member details",
            ),
            
            /// Add a member to workspace, office, or room with specified role
            WorkspaceProtocolRequest::AddMember {
                user_id,
                office_id,
                room_id,
                role,
                metadata: _metadata,
            } => {
                // Input validation: cannot specify both office and room simultaneously
                if office_id.is_some() && room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Cannot specify both office_id and room_id. Specify one for domain-level addition, or neither for workspace-level.".to_string(),
                    ));
                }
                Self::handle_result(
                    self.add_member_command_internal(
                        actor_user_id,
                        &user_id,
                        office_id.as_deref(),
                        room_id.as_deref(),
                        role,
                    ),
                    |_| WorkspaceProtocolResponse::Success("Member added successfully".to_string()),
                    "Failed to add member",
                )
            }
            
            /// Remove a member from workspace, office, or room
            WorkspaceProtocolRequest::RemoveMember {
                user_id,
                office_id,
                room_id,
            } => {
                // Input validation: cannot specify both office and room simultaneously  
                if office_id.is_some() && room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify at most one of office_id or room_id for member removal"
                            .to_string(),
                    ));
                }

                Self::handle_result(
                    self.remove_member_command_internal(
                        actor_user_id,
                        &user_id,
                        office_id.as_deref(),
                        room_id.as_deref(),
                    ),
                    |_| {
                        WorkspaceProtocolResponse::Success(
                            "Member removed successfully".to_string(),
                        )
                    },
                    "Failed to remove member",
                )
            }
            
            /// Update a member's role within the workspace
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id,
                role,
                metadata,
            } => Self::handle_result(
                self.update_member_role_command_internal(actor_user_id, &user_id, role, metadata),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member role updated successfully".to_string(),
                    )
                },
                "Failed to update member role",
            ),
            
            /// Update a member's specific permissions within a domain
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id,
                domain_id,
                permissions,
                operation,
            } => Self::handle_result(
                self.update_member_permissions_command_internal(
                    actor_user_id,
                    &user_id,
                    &domain_id,
                    permissions,
                    operation,
                ),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member permissions updated successfully".to_string(),
                    )
                },
                "Failed to update member permissions",
            ),
            
            /// List members in a specific office or room
            WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
                // Input validation: must specify exactly one domain type
                if office_id.is_some() == room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify exactly one of office_id or room_id".to_string(),
                    ));
                }
                // Use handlers::query::list_members implementation to avoid ambiguity
                Self::handle_result(
                    self.query_members(office_id.as_deref(), room_id.as_deref()),
                    WorkspaceProtocolResponse::Members,
                    "Failed to list members",
                )
            }
        };

        resp
    }
}
