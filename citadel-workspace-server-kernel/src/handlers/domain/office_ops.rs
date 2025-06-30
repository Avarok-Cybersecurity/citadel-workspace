//! # Office Operations Module
//!
//! This module defines office-specific operations for the domain system,
//! providing functionality for office management within workspaces.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;

/// Office-specific operations for the domain operations trait.
///
/// This module provides extension methods for office management,
/// including CRUD operations and listing within workspaces.
pub trait OfficeOperations<R: Ratchet + Send + Sync + 'static> {
    
    // ────────────────────────────────────────────────────────────────────────────
    // OFFICE-SPECIFIC OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Creates a new office within a workspace.
    ///
    /// # Arguments
    /// * `user_id` - ID of the user creating the office
    /// * `workspace_id` - ID of the parent workspace
    /// * `name` - Name for the new office
    /// * `description` - Description of the office
    /// * `mdx_content` - Optional MDX content for documentation
    fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError>;

    /// Retrieves an office by ID with permission validation.
    ///
    /// # Arguments
    /// * `user_id` - ID of the user requesting the office
    /// * `office_id` - ID of the office to retrieve
    ///
    /// # Returns
    /// * `Ok(String)` - Office data as string representation
    /// * `Err(NetworkError)` - Access denied or office not found
    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError>;

    /// Deletes an office and all associated rooms.
    ///
    /// # Arguments
    /// * `user_id` - ID of the user deleting the office
    /// * `office_id` - ID of the office to delete
    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError>;

    /// Updates office properties.
    ///
    /// # Arguments
    /// * `user_id` - ID of the user updating the office
    /// * `office_id` - ID of the office to update
    /// * `name` - Optional new name
    /// * `description` - Optional new description
    /// * `mdx_content` - Optional new MDX content
    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError>;

    /// Lists offices accessible to a user, optionally filtered by workspace.
    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError>;

    /// Lists offices within a specific workspace for a user.
    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError>;
}
