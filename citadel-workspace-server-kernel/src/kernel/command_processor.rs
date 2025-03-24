use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceCommand, WorkspaceResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Process a command and return a response
    pub fn process_command(
        &self,
        user_id: &str,
        command: WorkspaceCommand,
    ) -> Result<WorkspaceResponse, NetworkError> {
        match command {
            // Office commands
            WorkspaceCommand::CreateOffice { name, description } => {
                match self.create_office(user_id, &name, &description) {
                    Ok(office) => Ok(WorkspaceResponse::Office(office)),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to create office: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::GetOffice { office_id } => match self.get_office(user_id, &office_id)
            {
                Ok(office) => Ok(WorkspaceResponse::Office(office)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to get office: {}",
                    e
                ))),
            },
            WorkspaceCommand::DeleteOffice { office_id } => {
                match self.delete_office(user_id, &office_id) {
                    Ok(_) => Ok(WorkspaceResponse::Success),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to delete office: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::UpdateOffice {
                office_id,
                name,
                description,
            } => match self.update_office(
                user_id,
                &office_id,
                name.as_deref(),
                description.as_deref(),
            ) {
                Ok(updated_office) => Ok(WorkspaceResponse::Office(updated_office)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update office: {}",
                    e
                ))),
            },

            // Room commands
            WorkspaceCommand::CreateRoom {
                office_id,
                name,
                description,
            } => match self.create_room(user_id, &office_id, &name, &description) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to create room: {}",
                    e
                ))),
            },
            WorkspaceCommand::GetRoom { room_id } => match self.get_room(user_id, &room_id) {
                Ok(room) => Ok(WorkspaceResponse::Room(room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to get room: {}",
                    e
                ))),
            },
            WorkspaceCommand::DeleteRoom { room_id } => match self.delete_room(user_id, &room_id) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to delete room: {}",
                    e
                ))),
            },
            WorkspaceCommand::UpdateRoom {
                room_id,
                name,
                description,
            } => match self.update_room(user_id, &room_id, name.as_deref(), description.as_deref())
            {
                Ok(updated_room) => Ok(WorkspaceResponse::Room(updated_room)),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update room: {}",
                    e
                ))),
            },

            // Member commands
            WorkspaceCommand::AddMember {
                user_id: member_id,
                office_id,
                room_id,
                role,
            } => match self.add_member(
                user_id,
                &member_id,
                office_id.as_deref(),
                room_id.as_deref(),
                role,
            ) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to add member: {}",
                    e
                ))),
            },
            WorkspaceCommand::GetMember { user_id: member_id } => {
                match self.get_member(&member_id) {
                    Some(member) => Ok(WorkspaceResponse::Member(member)),
                    None => Ok(WorkspaceResponse::Error("Member not found".to_string())),
                }
            }
            WorkspaceCommand::UpdateMemberRole {
                user_id: member_id,
                role,
            } => match self.update_member_role(user_id, &member_id, role) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to update member role: {}",
                    e
                ))),
            },
            WorkspaceCommand::UpdateMemberPermissions {
                user_id: member_id,
                domain_id,
                permissions,
                operation,
            } => {
                // Update permissions for a member
                match self.update_permissions_for_member(
                    user_id,
                    &member_id,
                    &domain_id,
                    &permissions,
                    operation,
                ) {
                    Ok(_) => Ok(WorkspaceResponse::Success),
                    Err(e) => Ok(WorkspaceResponse::Error(format!(
                        "Failed to update member permissions: {}",
                        e
                    ))),
                }
            }
            WorkspaceCommand::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => match self.remove_member(&member_id) {
                Ok(_) => Ok(WorkspaceResponse::Success),
                Err(e) => Ok(WorkspaceResponse::Error(format!(
                    "Failed to remove member: {}",
                    e
                ))),
            },

            // Query commands
            WorkspaceCommand::ListOffices => {
                let offices = self.list_offices(user_id, None)?;
                Ok(WorkspaceResponse::Offices(offices))
            }
            WorkspaceCommand::ListRooms { office_id } => {
                let rooms = self.list_rooms(user_id, &office_id)?;
                Ok(WorkspaceResponse::Rooms(rooms))
            }
            WorkspaceCommand::ListMembers { office_id, room_id } => {
                match (office_id, room_id) {
                    (Some(office_id), None) => {
                        // List members in office
                        let members = match self.list_members_in_domain(user_id, &office_id) {
                            Ok(members) => members,
                            Err(e) => {
                                return Ok(WorkspaceResponse::Error(format!(
                                    "Failed to list members: {}",
                                    e
                                )))
                            }
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    (None, Some(room_id)) => {
                        // List members in room
                        let members = match self.list_members_in_domain(user_id, &room_id) {
                            Ok(members) => members,
                            Err(e) => {
                                return Ok(WorkspaceResponse::Error(format!(
                                    "Failed to list members: {}",
                                    e
                                )))
                            }
                        };
                        Ok(WorkspaceResponse::Members(members))
                    }
                    _ => Ok(WorkspaceResponse::Error(
                        "Must specify either office_id or room_id".to_string(),
                    )),
                }
            }
        }
    }
}
