use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Office, Workspace};

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper function to handle common error pattern
    fn handle_result<T, F>(
        result: Result<T, NetworkError>,
        success_mapper: F,
        error_msg: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError>
    where
        F: FnOnce(T) -> WorkspaceProtocolResponse,
    {
        match result {
            Ok(val) => Ok(success_mapper(val)),
            Err(e) => {
                println!("Error: {:?}", e);
                Ok(WorkspaceProtocolResponse::Error(format!(
                    "{}: {}",
                    error_msg,
                    e.to_string()
                )))
            }
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

            // Workspace commands
            WorkspaceProtocolRequest::LoadWorkspace => Self::handle_result(
                self.load_workspace(user_id),
                WorkspaceProtocolResponse::Workspace,
                "Failed to load workspace",
            ),
            WorkspaceProtocolRequest::CreateWorkspace {
                name,
                description,
                metadata,
                workspace_master_password,
            } => Self::handle_result(
                self.create_workspace(user_id, &name, &description, metadata, workspace_master_password),
                WorkspaceProtocolResponse::Workspace,
                "Failed to create workspace",
            ),
            WorkspaceProtocolRequest::GetWorkspace => Self::handle_result(
                self.get_workspace(user_id, crate::WORKSPACE_ROOT_ID),
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
                    user_id,
                    crate::WORKSPACE_ROOT_ID,
                    name.as_deref(),
                    description.as_deref(),
                    metadata,
                    workspace_master_password,
                ),
                WorkspaceProtocolResponse::Workspace,
                "Failed to update workspace",
            ),
            WorkspaceProtocolRequest::DeleteWorkspace { workspace_master_password } => Self::handle_result(
                self.delete_workspace(user_id, crate::WORKSPACE_ROOT_ID, workspace_master_password),
                |_| {
                    WorkspaceProtocolResponse::Success("Workspace deleted successfully".to_string())
                },
                "Failed to delete workspace",
            ),

            // Office commands
            WorkspaceProtocolRequest::CreateOffice {
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.create_office(user_id, &name, &description, mdx_content.as_deref()),
                |office| WorkspaceProtocolResponse::Office(office),
                "Failed to create office",
            ),
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.get_office(user_id, &office_id),
                |office| WorkspaceProtocolResponse::Office(office),
                "Failed to get office",
            ),
            WorkspaceProtocolRequest::DeleteOffice { office_id } => Self::handle_result(
                self.delete_office(user_id, &office_id),
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
                self.update_office(
                    user_id,
                    &office_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                |office| WorkspaceProtocolResponse::Office(office),
                "Failed to update office",
            ),
            WorkspaceProtocolRequest::ListOffices => Self::handle_result(
                self.list_all_offices(user_id),
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
                self.create_room(
                    user_id,
                    &office_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                |room| WorkspaceProtocolResponse::Room(room),
                "Failed to create room",
            ),
            WorkspaceProtocolRequest::GetRoom { room_id } => Self::handle_result(
                self.get_room(user_id, &room_id),
                |room| WorkspaceProtocolResponse::Room(room),
                "Failed to get room",
            ),
            WorkspaceProtocolRequest::DeleteRoom { room_id } => Self::handle_result(
                self.delete_room(user_id, &room_id),
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
                self.update_room(
                    user_id,
                    &room_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                |room| WorkspaceProtocolResponse::Room(room),
                "Failed to update room",
            ),
            WorkspaceProtocolRequest::ListRooms { office_id } => Self::handle_result(
                self.list_rooms(user_id, &office_id),
                WorkspaceProtocolResponse::Rooms,
                "Failed to list rooms",
            ),

            // Member commands
            WorkspaceProtocolRequest::AddMember {
                user_id: member_id,
                office_id,
                room_id,
                role,
                metadata: _,
            } => {
                if let Some(domain_id) = office_id.or(room_id) {
                    Self::handle_result(
                        self.add_user_to_domain(user_id, &domain_id, role),
                        |_| {
                            WorkspaceProtocolResponse::Success(
                                "Member added to domain successfully".to_string(),
                            )
                        },
                        "Failed to add member to domain",
                    )
                } else {
                    Ok(WorkspaceProtocolResponse::Error(
                        "Must specify either office_id or room_id".to_string(),
                    ))
                }
            }
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
                metadata: _,
            } => Self::handle_result(
                self.update_member_role(user_id, &member_id, role),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member role updated successfully".to_string(),
                    )
                },
                "Failed to update member role",
            ),
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id: member_id,
                domain_id,
                permissions,
                operation,
            } => Self::handle_result(
                self.update_member_permissions(
                    user_id,
                    &member_id,
                    &domain_id,
                    &permissions,
                ),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member permissions updated successfully".to_string(),
                    )
                },
                "Failed to update member permissions",
            ),
            WorkspaceProtocolRequest::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => {
                if let Some(domain_id) = office_id.or(room_id) {
                    Self::handle_result(
                        self.remove_user_from_domain(user_id, &member_id, &domain_id),
                        |_| {
                            WorkspaceProtocolResponse::Success(
                                "Member removed from domain successfully".to_string(),
                            )
                        },
                        "Failed to remove member from domain",
                    )
                } else {
                    // No domain specified, completely remove the user
                    Self::handle_result(
                        self.remove_member(&member_id),
                        |_| {
                            WorkspaceProtocolResponse::Success(
                                "Member removed successfully".to_string(),
                            )
                        },
                        "Failed to remove member",
                    )
                }
            }

            // Query commands
            WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
                Self::handle_result(
                    self.list_members(office_id.as_ref(), room_id.as_ref()),
                    WorkspaceProtocolResponse::Members,
                    "Failed to list members",
                )
            }
        };

        resp.map(|res| res.into())
    }

    fn load_workspace(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        self.domain_ops().load_workspace(user_id)
    }

    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.domain_ops().get_workspace(user_id, workspace_id)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops()
            .create_workspace(user_id, name, description, metadata)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops()
            .update_workspace(user_id, workspace_id, name, description, metadata)
    }

    fn list_all_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        // Since we have a single workspace model, we can get the workspace first and then list its offices
        match self.domain_ops().load_workspace(user_id) {
            Ok(workspace) => self
                .domain_ops()
                .list_offices_in_workspace(user_id, &workspace.id),
            Err(e) => Err(e),
        }
    }
}
