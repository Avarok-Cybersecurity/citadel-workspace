use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceCommand, WorkspaceResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper function to handle common error pattern
    fn handle_result<T, F: FnOnce(T) -> WorkspaceResponse>(
        result: Result<T, NetworkError>,
        success_handler: F,
        error_prefix: &str,
    ) -> Result<WorkspaceResponse, NetworkError> {
        match result {
            Ok(value) => Ok(success_handler(value)),
            Err(e) => Ok(WorkspaceResponse::Error(format!("{}: {}", error_prefix, e))),
        }
    }

    // Process a command and return a response
    pub fn process_command(
        &self,
        user_id: &str,
        command: WorkspaceCommand,
    ) -> Result<WorkspaceResponse, NetworkError> {
        match command {
            // Office commands
            WorkspaceCommand::CreateOffice { name, description } => Self::handle_result(
                self.create_office(user_id, &name, &description),
                WorkspaceResponse::Office,
                "Failed to create office",
            ),
            WorkspaceCommand::GetOffice { office_id } => Self::handle_result(
                self.get_office(user_id, &office_id),
                WorkspaceResponse::Office,
                "Failed to get office",
            ),
            WorkspaceCommand::DeleteOffice { office_id } => Self::handle_result(
                self.delete_office(user_id, &office_id),
                |_| WorkspaceResponse::Success,
                "Failed to delete office",
            ),
            WorkspaceCommand::UpdateOffice {
                office_id,
                name,
                description,
            } => Self::handle_result(
                self.update_office(user_id, &office_id, name.as_deref(), description.as_deref()),
                WorkspaceResponse::Office,
                "Failed to update office",
            ),

            // Room commands
            WorkspaceCommand::CreateRoom {
                office_id,
                name,
                description,
            } => Self::handle_result(
                self.create_room(user_id, &office_id, &name, &description),
                WorkspaceResponse::Room,
                "Failed to create room",
            ),
            WorkspaceCommand::GetRoom { room_id } => Self::handle_result(
                self.get_room(user_id, &room_id),
                WorkspaceResponse::Room,
                "Failed to get room",
            ),
            WorkspaceCommand::DeleteRoom { room_id } => Self::handle_result(
                self.delete_room(user_id, &room_id),
                |_| WorkspaceResponse::Success,
                "Failed to delete room",
            ),
            WorkspaceCommand::UpdateRoom {
                room_id,
                name,
                description,
            } => Self::handle_result(
                self.update_room(user_id, &room_id, name.as_deref(), description.as_deref()),
                WorkspaceResponse::Room,
                "Failed to update room",
            ),

            // Member commands
            WorkspaceCommand::AddMember {
                user_id: member_id,
                office_id,
                room_id,
                role,
            } => Self::handle_result(
                self.add_member(
                    user_id,
                    &member_id,
                    office_id.as_deref(),
                    room_id.as_deref(),
                    role,
                ),
                |_| WorkspaceResponse::Success,
                "Failed to add member",
            ),
            WorkspaceCommand::GetMember { user_id: member_id } => {
                match self.get_member(&member_id) {
                    Some(member) => Ok(WorkspaceResponse::Member(member)),
                    None => Ok(WorkspaceResponse::Error("Member not found".to_string())),
                }
            }
            WorkspaceCommand::UpdateMemberRole {
                user_id: member_id,
                role,
            } => Self::handle_result(
                self.update_member_role(user_id, &member_id, role),
                |_| WorkspaceResponse::Success,
                "Failed to update member role",
            ),
            WorkspaceCommand::UpdateMemberPermissions {
                user_id: member_id,
                domain_id,
                permissions,
                operation,
            } => Self::handle_result(
                self.update_permissions_for_member(
                    user_id,
                    &member_id,
                    &domain_id,
                    &permissions,
                    operation,
                ),
                |_| WorkspaceResponse::Success,
                "Failed to update member permissions",
            ),
            WorkspaceCommand::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => {
                // If office_id or room_id is provided, only remove from that domain
                // Otherwise, completely remove the user
                if let Some(domain_id) = office_id.or(room_id) {
                    Self::handle_result(
                        self.remove_member_from_domain(&member_id, &domain_id),
                        |_| WorkspaceResponse::Success,
                        "Failed to remove member from domain",
                    )
                } else {
                    // No domain specified, completely remove the user
                    Self::handle_result(
                        self.remove_member(&member_id),
                        |_| WorkspaceResponse::Success,
                        "Failed to remove member",
                    )
                }
            }

            // Query commands
            WorkspaceCommand::ListOffices => {
                let offices = self.list_offices(user_id, None)?;
                Ok(WorkspaceResponse::Offices(offices))
            }
            WorkspaceCommand::ListRooms { office_id } => {
                let rooms = self.list_rooms(user_id, &office_id)?;
                Ok(WorkspaceResponse::Rooms(rooms))
            }
            WorkspaceCommand::ListMembers { office_id, room_id } => match (office_id, room_id) {
                (Some(office_id), None) => Self::handle_result(
                    self.list_members_in_domain(user_id, &office_id),
                    WorkspaceResponse::Members,
                    "Failed to list members",
                ),
                (None, Some(room_id)) => Self::handle_result(
                    self.list_members_in_domain(user_id, &room_id),
                    WorkspaceResponse::Members,
                    "Failed to list members",
                ),
                _ => Ok(WorkspaceResponse::Error(
                    "Must specify either office_id or room_id".to_string(),
                )),
            },
        }
    }
}
