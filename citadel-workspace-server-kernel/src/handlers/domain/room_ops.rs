//! # Room Operations Module
//!
//! This module defines room-specific operations for the domain system,
//! providing functionality for room management within offices.

use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Room;

/// Room-specific operations for the domain operations trait.
///
/// This module provides extension methods for room management,
/// including CRUD operations and listing within offices.
pub trait RoomOperations<R: Ratchet + Send + Sync + 'static> {
    // ────────────────────────────────────────────────────────────────────────────
    // ROOM-SPECIFIC OPERATIONS
    // ────────────────────────────────────────────────────────────────────────────

    /// Creates a new room within an office.
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// Retrieves a room by ID with permission validation.
    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

    /// Deletes a room and removes it from its parent office.
    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError>;

    /// Updates room properties.
    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError>;

    /// Lists rooms accessible to a user, optionally filtered by office.
    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError>;
}
