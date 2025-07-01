use crate::handlers::domain::{DomainOperations, RoomOperations};
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Room;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Update a room with new details
    pub(crate) fn update_room_command_internal(
        &self,
        actor_user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // Call the domain operation to update the room
        self.domain_ops()
            .update_room(actor_user_id, room_id, name, description, mdx_content)
    }
}
