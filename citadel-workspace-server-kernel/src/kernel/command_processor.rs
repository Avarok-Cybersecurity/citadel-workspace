use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{UserRole, Workspace};

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
                self.load_workspace(user_id, None),
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
                    user_id,
                    &name,
                    &description,
                    metadata,
                    workspace_master_password,
                ),
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
            WorkspaceProtocolRequest::DeleteWorkspace {
                workspace_master_password,
            } => Self::handle_result(
                self.delete_workspace(user_id, workspace_master_password),
                WorkspaceProtocolResponse::Success,
                "Failed to delete workspace",
            ),

            // Office commands
            WorkspaceProtocolRequest::CreateOffice {
                workspace_id,
                name,
                description,
                mdx_content,
                metadata: _, // Ensure metadata is handled or explicitly ignored if not used by create_office
            } => Self::handle_result(
                self.domain_ops().create_office(
                    user_id,
                    &workspace_id,
                    &name,
                    &description,
                    mdx_content.as_deref(),
                ),
                |office_struct| WorkspaceProtocolResponse::Office(office_struct),
                "Failed to create office",
            ),
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.domain_ops().get_office(user_id, &office_id),
                |office| WorkspaceProtocolResponse::Office(office),
                "Failed to get office",
            ),
            WorkspaceProtocolRequest::DeleteOffice { office_id } => Self::handle_result(
                self.domain_ops().delete_office(user_id, &office_id),
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
                self.domain_ops().update_office(
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
                self.domain_ops().list_offices(user_id, None),
                WorkspaceProtocolResponse::Offices,
                "Failed to list offices",
            ),
            /*WorkspaceProtocolRequest::AddOfficeToWorkspace { office_id } => Self::handle_result(
                self.domain_ops().add_office_to_workspace(user_id, crate::WORKSPACE_ROOT_ID, &office_id),
                |_| WorkspaceProtocolResponse::Success("Office added to workspace successfully".to_string()),
                "Failed to add office to workspace",
            ),
            WorkspaceProtocolRequest::RemoveOfficeFromWorkspace { office_id } => Self::handle_result(
                self.domain_ops().remove_office_from_workspace(user_id, crate::WORKSPACE_ROOT_ID, &office_id),
                |_| WorkspaceProtocolResponse::Success("Office removed from workspace successfully".to_string()),
                "Failed to remove office from workspace",
            ),*/
            // Room commands
            WorkspaceProtocolRequest::CreateRoom {
                office_id,
                name,
                description,
                mdx_content,
                metadata: _,
            } => Self::handle_result(
                self.domain_ops().create_room(
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
                self.domain_ops().get_room(user_id, &room_id),
                |room| WorkspaceProtocolResponse::Room(room),
                "Failed to get room",
            ),
            WorkspaceProtocolRequest::DeleteRoom { room_id } => Self::handle_result(
                self.domain_ops().delete_room(user_id, &room_id),
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
                self.domain_ops().update_room(
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
                self.domain_ops()
                    .list_rooms(user_id, Some(office_id.clone())),
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
            } => Self::handle_result(
                self.add_member(
                    user_id,
                    &member_id,
                    office_id.as_deref(),
                    room_id.as_deref(),
                    role,
                ),
                |_| {
                    WorkspaceProtocolResponse::Success(
                        "Member added to domain successfully".to_string(),
                    )
                },
                "Failed to add member to domain",
            ),
            WorkspaceProtocolRequest::GetMember {
                user_id: target_member_id,
            } => match self.tx_manager().get_member(user_id, &target_member_id) {
                Ok(Some(member)) => Ok(WorkspaceProtocolResponse::Member(member)),
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "Member not found".to_string(),
                )),
                Err(error) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get member: {error}"
                ))),
            },
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id: member_id,
                role,
                metadata: _,
            } => Self::handle_result(
                self.tx_manager()
                    .update_member_role(user_id, &member_id, role),
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
                self.tx_manager().update_member_permissions(
                    user_id,
                    &member_id,
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
            WorkspaceProtocolRequest::RemoveMember {
                user_id: member_id,
                office_id,
                room_id,
            } => {
                if let Some(domain_id) = office_id.or(room_id) {
                    Self::handle_result(
                        self.domain_ops()
                            .remove_user_from_domain(user_id, &member_id, &domain_id),
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
                        self.tx_manager().delete_member(user_id, &member_id),
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
                if office_id.is_some() == room_id.is_some() {
                    // True if both are Some or both are None
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify exactly one of office_id or room_id".to_string(),
                    ));
                }
                Self::handle_result(
                    self.list_members(office_id.as_ref(), room_id.as_ref()),
                    WorkspaceProtocolResponse::Members,
                    "Failed to list members",
                )
            }
        };

        resp.map(|res| res.into())
    }

    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().load_workspace(user_id, workspace_id_opt)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops()
            .create_workspace(user_id, name, description, metadata, workspace_password)
    }

    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.domain_ops().get_workspace(user_id, workspace_id)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().update_workspace(
            user_id,
            workspace_id,
            name,
            description,
            metadata,
            workspace_master_password,
        )
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_master_password: String,
    ) -> Result<String, NetworkError> {
        match self.domain_ops().delete_workspace(
            user_id,
            crate::WORKSPACE_ROOT_ID,
            workspace_master_password,
        ) {
            Ok(_deleted_workspace) => {
                // The _deleted_workspace is available here if needed, but we just return a success message.
                Ok("Workspace deleted successfully".to_string())
            }
            Err(e) => Err(e),
        }
    }

    pub fn add_member(
        &self,
        actor_user_id: &str,
        target_member_id: &str,
        office_id: Option<&str>,
        room_id: Option<&str>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Add to the main workspace first with a default role or the provided role if applicable at workspace level
        // Assuming 'role' is for the specific domain (office/room), and a general 'Member' role for the workspace itself.
        // The trait add_user_to_workspace takes a specific role.
        self.domain_ops().add_user_to_workspace(
            actor_user_id,
            crate::WORKSPACE_ROOT_ID,
            target_member_id,
            role.clone(),
        )?; // Cloned role

        // Then add to the specific office or room domain
        if let Some(domain_id_str) = office_id.or(room_id) {
            self.domain_ops().add_user_to_domain(
                actor_user_id,
                target_member_id,
                domain_id_str,
                role,
            )?;
        }
        // If no specific office/room, they are just added to the workspace.
        Ok(())
    }
}
