use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};

// Import submodules
mod member_commands;
mod office_commands;
mod room_commands;
mod workspace_commands;

// Re-export the submodules

impl<R: Ratchet> WorkspaceServerKernel<R> {
    /// Helper function to handle common error pattern
    pub(crate) fn handle_result<T, F>(
        result: Result<T, NetworkError>,
        success_mapper: F,
        error_msg_prefix: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError>
    where
        F: FnOnce(T) -> WorkspaceProtocolResponse,
    {
        match result {
            Ok(val) => Ok(success_mapper(val)),
            Err(e) => {
                let full_error_msg = format!("{}: {}", error_msg_prefix, e);
                error!("{}", full_error_msg);
                Ok(WorkspaceProtocolResponse::Error(full_error_msg))
            }
        }
    }

    /// Process a command and return a response
    pub fn process_command(
        &self,
        actor_user_id: &str,
        command: WorkspaceProtocolRequest,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        println!(
            "[PROCESS_COMMAND_ENTRY] actor_user_id: {}, command: {:?}",
            actor_user_id, command
        );
        let resp = match command {
            WorkspaceProtocolRequest::Message { .. } => {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Message command is not supported by server. Only peers may receive this type"
                        .to_string(),
                ))
            }

            // Workspace commands
            WorkspaceProtocolRequest::LoadWorkspace => Self::handle_result(
                self.load_workspace(actor_user_id, None),
                WorkspaceProtocolResponse::Workspace,
                "Failed to load workspace",
            ),
            WorkspaceProtocolRequest::CreateWorkspace {
                name,
                description,
                metadata,
                workspace_master_password,
            } => Self::handle_result(
                self.create_workspace(
                    actor_user_id,
                    &name,
                    &description,
                    metadata,
                    workspace_master_password,
                ),
                WorkspaceProtocolResponse::Workspace,
                "Failed to create workspace",
            ),
            WorkspaceProtocolRequest::GetWorkspace => Self::handle_result(
                self.get_workspace(actor_user_id, crate::WORKSPACE_ROOT_ID),
                WorkspaceProtocolResponse::Workspace,
                "Failed to get workspace",
            ),
            WorkspaceProtocolRequest::UpdateWorkspace {
                name,
                description,
                metadata,
                workspace_master_password,
            } => Self::handle_result(
                self.update_workspace(
                    actor_user_id,
                    crate::WORKSPACE_ROOT_ID,
                    name.as_deref(),
                    description.as_deref(),
                    metadata,
                    workspace_master_password,
                ),
                WorkspaceProtocolResponse::Workspace,
                "Failed to update workspace",
            ),
            WorkspaceProtocolRequest::DeleteWorkspace {
                workspace_master_password,
            } => Self::handle_result(
                self.delete_workspace(actor_user_id, workspace_master_password),
                |_| {
                    WorkspaceProtocolResponse::Success("Workspace deleted successfully".to_string())
                },
                "Failed to delete workspace",
            ),

            // Office commands
            WorkspaceProtocolRequest::CreateOffice {
                workspace_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.domain_ops().create_office(
                    actor_user_id,
                    &workspace_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Office,
                "Failed to create office",
            ),
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.get_office_command_internal(actor_user_id, &office_id),
                |response| response,
                "Failed to get office",
            ),
            WorkspaceProtocolRequest::DeleteOffice { office_id } => Self::handle_result(
                self.domain_ops().delete_office(actor_user_id, &office_id),
                |_| WorkspaceProtocolResponse::Success("Office deleted successfully".to_string()),
                "Failed to delete office",
            ),
            WorkspaceProtocolRequest::UpdateOffice {
                office_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.update_office_command_internal(
                    actor_user_id,
                    &office_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Office,
                "Failed to update office",
            ),
            WorkspaceProtocolRequest::ListOffices => Self::handle_result(
                self.domain_ops().list_offices(actor_user_id, None),
                WorkspaceProtocolResponse::Offices,
                "Failed to list offices",
            ),

            // Room commands
            WorkspaceProtocolRequest::CreateRoom {
                office_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.domain_ops().create_room(
                    actor_user_id,
                    &office_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Room,
                "Failed to create room",
            ),
            WorkspaceProtocolRequest::GetRoom { room_id } => Self::handle_result(
                self.domain_ops().get_room(actor_user_id, &room_id),
                WorkspaceProtocolResponse::Room,
                "Failed to get room",
            ),
            WorkspaceProtocolRequest::DeleteRoom { room_id } => Self::handle_result(
                self.domain_ops().delete_room(actor_user_id, &room_id),
                |_| WorkspaceProtocolResponse::Success("Room deleted successfully".to_string()),
                "Failed to delete room",
            ),
            WorkspaceProtocolRequest::UpdateRoom {
                room_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.update_room_command_internal(
                    actor_user_id,
                    &room_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                WorkspaceProtocolResponse::Room,
                "Failed to update room",
            ),
            WorkspaceProtocolRequest::ListRooms { office_id } => Self::handle_result(
                self.domain_ops().list_rooms(actor_user_id, Some(office_id)),
                WorkspaceProtocolResponse::Rooms,
                "Failed to list rooms",
            ),

            // Member commands
            WorkspaceProtocolRequest::GetMember { user_id } => Self::handle_result(
                self.get_member_command_internal(actor_user_id, &user_id),
                |response| response,
                "Failed to get member details",
            ),
            WorkspaceProtocolRequest::AddMember {
                user_id,
                office_id,
                room_id,
                role,
                metadata: _metadata,
            } => {
                if office_id.is_some() && room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Cannot specify both office_id and room_id. Specify one for domain-level addition, or neither for workspace-level.".to_string(),
                    ));
                }
                Self::handle_result(
                    self.add_member_command_internal(
                        actor_user_id,
                        &user_id,
                        office_id.as_deref(),
                        room_id.as_deref(),
                        role,
                    ),
                    |_| WorkspaceProtocolResponse::Success("Member added successfully".to_string()),
                    "Failed to add member",
                )
            }
            WorkspaceProtocolRequest::RemoveMember {
                user_id,
                office_id,
                room_id,
            } => {
                if office_id.is_some() && room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify at most one of office_id or room_id for member removal"
                            .to_string(),
                    ));
                }

                Self::handle_result(
                    self.remove_member_command_internal(
                        actor_user_id,
                        &user_id,
                        office_id.as_deref(),
                        room_id.as_deref(),
                    ),
                    |_| {
                        WorkspaceProtocolResponse::Success(
                            "Member removed successfully".to_string(),
                        )
                    },
                    "Failed to remove member",
                )
            }
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id,
                role,
                metadata,
            } => Self::handle_result(
                self.update_member_role_command_internal(actor_user_id, &user_id, role, metadata),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member role updated successfully".to_string(),
                    )
                },
                "Failed to update member role",
            ),
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id,
                domain_id,
                permissions,
                operation,
            } => Self::handle_result(
                self.update_member_permissions_command_internal(
                    actor_user_id,
                    &user_id,
                    &domain_id,
                    permissions,
                    operation,
                ),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member permissions updated successfully".to_string(),
                    )
                },
                "Failed to update member permissions",
            ),
            WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
                if office_id.is_some() == room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify exactly one of office_id or room_id".to_string(),
                    ));
                }
                // Use handlers::query::list_members implementation to avoid ambiguity
                Self::handle_result(
                    self.query_members(office_id.as_deref(), room_id.as_deref()),
                    WorkspaceProtocolResponse::Members,
                    "Failed to list members",
                )
            }
        };

        resp
    }
}
