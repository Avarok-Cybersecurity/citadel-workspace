//! # Async Office Operations Module
//!
//! This module provides async office-specific operations

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;

/// Async office-specific operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncOfficeOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Creates a new office within a workspace
    async fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
        is_default: Option<bool>,
    ) -> Result<Office, NetworkError>;

    /// Retrieves an office by ID with permission validation
    async fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError>;

    /// Deletes an office and all associated rooms
    async fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError>;

    /// Updates office properties
    async fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        is_default: Option<bool>,
    ) -> Result<Office, NetworkError>;

    /// Lists offices accessible to a user, optionally filtered by workspace
    async fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError>;

    /// Lists offices within a specific workspace for a user
    async fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError>;
}
