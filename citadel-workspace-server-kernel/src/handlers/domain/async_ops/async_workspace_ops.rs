//! # Async Workspace Operations Module
//!
//! This module provides async workspace-specific operations
use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{UserRole, Workspace};

use crate::handlers::domain::server_ops::async_domain_server_ops::WorkspaceDBList;

/// Async workspace-specific operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncWorkspaceOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Retrieves a workspace by ID with permission validation
    async fn get_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError>;

    /// Retrieves detailed workspace information
    async fn get_workspace_details(
        &self,
        user_id: &str,
        ws_id: &str,
    ) -> Result<Workspace, NetworkError>;

    /// Creates a new workspace with master password protection
    async fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Deletes a workspace with master password verification
    async fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError>;

    /// Updates workspace properties with master password verification
    async fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError>;

    /// Loads the primary workspace for a user
    async fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError>;

    /// Lists all workspaces accessible by a user
    async fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError>;

    /// Gets all workspace IDs
    async fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError>;

    /// Adds an office to a workspace's office list
    async fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;

    /// Removes an office from a workspace's office list
    async fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError>;

    /// Adds a user to a workspace with the specified role
    async fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Removes a user from a workspace and all associated permissions
    async fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError>;
}
