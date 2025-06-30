//! # Workspace Operations Module
//!
//! This module defines workspace-specific operations for the domain system,
//! providing functionality for workspace management, member operations, and office relationships.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{UserRole, Workspace};
use crate::handlers::domain::functions::workspace::workspace_ops::WorkspaceDBList;

/// Workspace-specific operations for the domain operations trait.
///
/// This module provides extension methods for workspace management,
/// including CRUD operations, member management, and office relationships.
pub trait WorkspaceOperations<R: Ratchet + Send + Sync + 'static> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // WORKSPACE-SPECIFIC OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Retrieves a workspace by ID with permission validation.
    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError>;

    /// Retrieves detailed workspace information (potentially more verbose than get_workspace).
    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError>;

    /// Creates a new workspace with master password protection.
    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Deletes a workspace with master password verification.
    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError>;

    /// Updates workspace properties with master password verification.
    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Loads the primary workspace for a user (or a specific one if ID provided).
    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError>;

    /// Lists all workspaces accessible by a user.
    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError>;

    /// Gets all workspace IDs (primarily for internal server use).
    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError>;
    
    // ────────────────────────────────────────────────────────────────────────────
    // WORKSPACE-OFFICE RELATIONSHIP OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Adds an office to a workspace's office list.
    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;

    /// Removes an office from a workspace's office list.
    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;
    
    // ────────────────────────────────────────────────────────────────────────────
    // WORKSPACE MEMBER MANAGEMENT OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Adds a user to a workspace with the specified role.
    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Removes a user from a workspace and all associated permissions.
    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError>;
}
