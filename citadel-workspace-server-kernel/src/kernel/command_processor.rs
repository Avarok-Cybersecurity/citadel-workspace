use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper function to handle common error pattern
    fn handle_result<T, F: FnOnce(T) -> WorkspaceProtocolResponse>(
        result: Result<T, NetworkError>,
        success_handler: F,
        error_prefix: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        match result {
            Ok(value) => Ok(success_handler(value)),
            Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                "{}: {}",
                error_prefix, e
            ))),
        }
    }

    // Process a command and return a response
    pub fn process_command(
        &self,
        user_id: &str,
        command: WorkspaceProtocolRequest,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        let resp = match command {
            WorkspaceProtocolRequest::Message { .. } => {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Message command is not supported by server. Only peers may receive this type"
                        .to_string(),
                ))
            }
            // Office commands
            WorkspaceProtocolRequest::CreateOffice { name, description } => Self::handle_result(
                self.create_office(user_id, &name, &description),
                WorkspaceProtocolResponse::Office,
                "Failed to create office",
            ),
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.get_office(user_id, &office_id),
                WorkspaceProtocolResponse::Office,
                "Failed to get office",
            ),
            WorkspaceProtocolRequest::DeleteOffice { office_id } => Self::handle_result(
                self.delete_office(user_id, &office_id),
                |_| WorkspaceProtocolResponse::Success,
                "Failed to delete office",
            ),
            WorkspaceProtocolRequest::UpdateOffice {
                office_id,
                name,
                description,
            } => Self::handle_result(
                self.update_office(user_id, &office_id, name.as_deref(), description.as_deref()),
                WorkspaceProtocolResponse::Office,
                "Failed to update office",
            ),

            // Room commands
            WorkspaceProtocolRequest::CreateRoom {
                office_id,
                name,
                description,
            } => Self::handle_result(
                self.create_room(user_id, &office_id, &name, &description),
                WorkspaceProtocolResponse::Room,
                "Failed to create room",
            ),
            WorkspaceProtocolRequest::GetRoom { room_id } => Self::handle_result(
                self.get_room(user_id, &room_id),
                WorkspaceProtocolResponse::Room,
                "Failed to get room",
            ),
            WorkspaceProtocolRequest::DeleteRoom { room_id } => Self::handle_result(
                self.delete_room(user_id, &room_id),
                |_| WorkspaceProtocolResponse::Success,
                "Failed to delete room",
            ),
            WorkspaceProtocolRequest::UpdateRoom {
                room_id,
                name,
                description,
            } => Self::handle_result(
                self.update_room(user_id, &room_id, name.as_deref(), description.as_deref()),
                WorkspaceProtocolResponse::Room,
                "Failed to update room",
            ),

            // Member commands
            WorkspaceProtocolRequest::AddMember {
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
                |_| WorkspaceProtocolResponse::Success,
                "Failed to add member",
            ),
            WorkspaceProtocolRequest::GetMember { user_id: member_id } => {
                match self.get_member(&member_id) {
                    Some(member) => Ok(WorkspaceProtocolResponse::Member(member)),
                    None => Ok(WorkspaceProtocolResponse::Error(
                        "Member not found".to_string(),
                    )),
                }
            }
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id: member_id,
                role,
            } => Self::handle_result(
                self.update_member_role(user_id, &member_id, role),
                |_| WorkspaceProtocolResponse::Success,
                "Failed to update member role",
            ),
            WorkspaceProtocolRequest::UpdateMemberPermissions {
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
                |_| WorkspaceProtocolResponse::Success,
                "Failed to update member permissions",
            ),
            WorkspaceProtocolRequest::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => {
                // If office_id or room_id is provided, only remove from that domain
                // Otherwise, completely remove the user
                if let Some(domain_id) = office_id.or(room_id) {
                    Self::handle_result(
                        self.remove_member_from_domain(&member_id, &domain_id),
                        |_| WorkspaceProtocolResponse::Success,
                        "Failed to remove member from domain",
                    )
                } else {
                    // No domain specified, completely remove the user
                    Self::handle_result(
                        self.remove_member(&member_id),
                        |_| WorkspaceProtocolResponse::Success,
                        "Failed to remove member",
                    )
                }
            }

            // Query commands
            WorkspaceProtocolRequest::ListOffices => {
                let offices = self.list_offices(user_id, None)?;
                Ok(WorkspaceProtocolResponse::Offices(offices))
            }
            WorkspaceProtocolRequest::ListRooms { office_id } => {
                let rooms = self.list_rooms(user_id, &office_id)?;
                Ok(WorkspaceProtocolResponse::Rooms(rooms))
            }
            WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
                match (office_id, room_id) {
                    (Some(office_id), None) => Self::handle_result(
                        self.list_members_in_domain(user_id, &office_id),
                        WorkspaceProtocolResponse::Members,
                        "Failed to list members",
                    ),
                    (None, Some(room_id)) => Self::handle_result(
                        self.list_members_in_domain(user_id, &room_id),
                        WorkspaceProtocolResponse::Members,
                        "Failed to list members",
                    ),
                    _ => Ok(WorkspaceProtocolResponse::Error(
                        "Must specify either office_id or room_id".to_string(),
                    )),
                }
            }
        };

        resp.map(|res| res.into())
    }
}
