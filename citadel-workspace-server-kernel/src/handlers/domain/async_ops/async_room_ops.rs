//! # Async Room Operations Module
//!
//! This module provides async room-specific operations

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Room;

/// Async room-specific operations
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncRoomOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Creates a new room within an office
    async fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// Retrieves a room by ID with permission validation
    async fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

    /// Deletes a room and removes it from its parent office
    async fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

    /// Updates room properties
    async fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// Lists rooms accessible to a user, optionally filtered by office
    async fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError>;
}
