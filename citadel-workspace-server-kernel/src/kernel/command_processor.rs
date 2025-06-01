use crate::handlers::domain::DomainOperations;
use crate::kernel::WorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_logging::error;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Room;
use citadel_workspace_types::structs::{Office, Permission, UserRole, Workspace};
use citadel_workspace_types::UpdateOperation;
use serde_json;

impl<R: Ratchet> WorkspaceServerKernel<R> {
    // Helper function to handle common error pattern
    fn handle_result<T, F>(
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

    // Process a command and return a response
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
                |office_json_string: String| match serde_json::from_str::<Office>(
                    &office_json_string,
                ) {
                    Ok(office_struct) => WorkspaceProtocolResponse::Office(office_struct),
                    Err(e) => {
                        let err_msg = format!(
                            "Internal error: Failed to process office data after creation: {}",
                            e
                        );
                        error!(
                            "Failed to deserialize office JSON from create_office: {}. JSON: {}",
                            e, office_json_string
                        );
                        WorkspaceProtocolResponse::Error(err_msg)
                    }
                },
                "Failed to create office",
            ),
            WorkspaceProtocolRequest::GetOffice { office_id } => Self::handle_result(
                self.domain_ops().get_office(actor_user_id, &office_id),
                |office_json_string: String| match serde_json::from_str::<Office>(
                    &office_json_string,
                ) {
                    Ok(office_struct) => WorkspaceProtocolResponse::Office(office_struct),
                    Err(e) => {
                        let err_msg = format!(
                            "Internal error: Failed to process office data on retrieval: {}",
                            e
                        );
                        error!(
                            "Failed to deserialize office JSON from get_office: {}. JSON: {}",
                            e, office_json_string
                        );
                        WorkspaceProtocolResponse::Error(err_msg)
                    }
                },
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
                self.domain_ops().update_office(
                    actor_user_id,
                    &office_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                |office_struct: Office| WorkspaceProtocolResponse::Office(office_struct),
                "Failed to update office",
            ),
            WorkspaceProtocolRequest::ListOffices => Self::handle_result(
                self.domain_ops().list_offices(actor_user_id, None),
                |offices_vec: Vec<Office>| WorkspaceProtocolResponse::Offices(offices_vec),
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
                |room_struct: Room| WorkspaceProtocolResponse::Room(room_struct),
                "Failed to create room",
            ),
            WorkspaceProtocolRequest::GetRoom { room_id } => Self::handle_result(
                self.domain_ops().get_room(actor_user_id, &room_id),
                |room_struct: Room| WorkspaceProtocolResponse::Room(room_struct),
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
                self.domain_ops().update_room(
                    actor_user_id,
                    &room_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                ),
                |room_struct: Room| WorkspaceProtocolResponse::Room(room_struct),
                "Failed to update room",
            ),
            WorkspaceProtocolRequest::ListRooms { office_id } => Self::handle_result(
                self.domain_ops().list_rooms(actor_user_id, Some(office_id)),
                |rooms_vec: Vec<Room>| WorkspaceProtocolResponse::Rooms(rooms_vec),
                "Failed to list rooms",
            ),
            WorkspaceProtocolRequest::GetMember { user_id } => Self::handle_result(
                self.get_member_command_internal(actor_user_id, &user_id),
                |response| response,
                "Failed to get member details",
            ),

            // Member commands
            WorkspaceProtocolRequest::AddMember {
                user_id, // Changed from target_member_id
                office_id,
                room_id,
                role,
                metadata: _, // Added metadata field
            } => {
                if office_id.is_some() == room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify exactly one of office_id or room_id, or neither for workspace-level member addition".to_string(),
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
                user_id, // Changed from target_member_id
                office_id,
                room_id,
            } => {
                if office_id.is_some() && room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify at most one of office_id or room_id for member removal"
                            .to_string(),
                    ));
                }

                let result =
                    if let Some(domain_id_str) = office_id.as_deref().or(room_id.as_deref()) {
                        self.domain_ops().remove_user_from_domain(
                            actor_user_id,
                            &user_id,
                            domain_id_str,
                        )
                    } else {
                        self.domain_ops().remove_user_from_workspace(
                            actor_user_id,
                            &user_id,
                            crate::WORKSPACE_ROOT_ID,
                        )
                    };

                Self::handle_result(
                    result,
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

            // Query commands
            WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
                if office_id.is_some() == room_id.is_some() {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Must specify exactly one of office_id or room_id".to_string(),
                    ));
                }
                Self::handle_result(
                    self.list_members(office_id.as_deref(), room_id.as_deref()),
                    WorkspaceProtocolResponse::Members,
                    "Failed to list members",
                )
            }
        };

        resp
    }

    // Helper methods that were previously in the lower part of process_command
    // These should be actual methods of WorkspaceServerKernel<R>
    fn load_workspace(
        &self,
        actor_user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops()
            .load_workspace(actor_user_id, workspace_id_opt)
    }

    fn create_workspace(
        &self,
        actor_user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().create_workspace(
            actor_user_id,
            name,
            description,
            metadata,
            workspace_password,
        )
    }

    fn get_workspace(
        &self,
        actor_user_id: &str,
        workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().get_workspace(actor_user_id, workspace_id)
    }

    fn update_workspace(
        &self,
        actor_user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.domain_ops().update_workspace(
            actor_user_id,
            workspace_id,
            name,
            description,
            metadata,
            workspace_master_password,
        )
    }

    fn delete_workspace(
        &self,
        actor_user_id: &str,
        workspace_master_password: String,
    ) -> Result<String, NetworkError> {
        match self.domain_ops().delete_workspace(
            actor_user_id,
            crate::WORKSPACE_ROOT_ID,
            workspace_master_password,
        ) {
            Ok(_deleted_workspace) => Ok("Workspace deleted successfully".to_string()),
            Err(e) => Err(e),
        }
    }

    // Implement the add_member_command_internal method using domain_ops().add_user_to_workspace() and domain_ops().add_user_to_domain()
    fn add_member_command_internal(
        &self,
        actor_user_id: &str,
        target_member_id: &str,
        office_id_opt: Option<&str>,
        room_id_opt: Option<&str>,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        println!(
            "[ADD_MEMBER_CMD_INTERNAL_ENTRY] actor_user_id: {}",
            actor_user_id
        );
        let workspace_id_for_membership: String;
        let final_target_domain_id_str: String;

        if let Some(office_id_str) = office_id_opt {
            final_target_domain_id_str = office_id_str.to_string();
            let office_json = self.domain_ops().get_office(actor_user_id, office_id_str)?;
            let office: Office = serde_json::from_str(&office_json)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize office JSON in add_member_command_internal. Office ID: {}. Error: {}. JSON: {}", office_id_str, e, office_json)))?;
            workspace_id_for_membership = office.workspace_id;
        } else if let Some(room_id_str) = room_id_opt {
            final_target_domain_id_str = room_id_str.to_string();
            // get_room returns the Room struct directly
            let room: Room = self.domain_ops().get_room(actor_user_id, room_id_str)?;

            // get_office for the parent office returns a JSON string
            let parent_office_json = self
                .domain_ops()
                .get_office(actor_user_id, &room.office_id)?;
            let parent_office: Office = serde_json::from_str(&parent_office_json)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize parent office JSON in add_member_command_internal. Parent Office ID: {}. Error: {}. JSON: {}", room.office_id, e, parent_office_json)))?;
            workspace_id_for_membership = parent_office.workspace_id;
        } else {
            error!("add_member_command_internal called without office_id or room_id. This should be caught by process_command.");
            return Err(NetworkError::msg(
                "Internal error: AddMember called without specific domain (office/room) and no fallback workspace ID resolution.",
            ));
        }

        citadel_logging::debug!(target: "citadel", "[ADD_MEMBER_CMD_INTERNAL] Determined workspace_id_for_membership: {}", workspace_id_for_membership);

        self.domain_ops().add_user_to_workspace(
            actor_user_id,
            target_member_id,
            &workspace_id_for_membership,
            role.clone(),
        )?;
        citadel_logging::debug!(target: "citadel", "[ADD_MEMBER_CMD_INTERNAL] Added {} to workspace {}", target_member_id, workspace_id_for_membership);

        self.domain_ops().add_user_to_domain(
            actor_user_id,
            target_member_id,
            &final_target_domain_id_str,
            role,
        )?;
        citadel_logging::debug!(target: "citadel", "[ADD_MEMBER_CMD_INTERNAL] Added {} to specific domain {}", target_member_id, final_target_domain_id_str);

        Ok(())
    }

    fn get_member_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
    ) -> Result<WorkspaceProtocolResponse, NetworkError> {
        // Ensure actor exists (basic permission, can be expanded)
        if self.domain_ops().get_user(actor_user_id).is_none() {
            return Err(NetworkError::msg(format!(
                "Requesting user (actor) '{}' not found.",
                actor_user_id
            )));
        }

        match self.domain_ops().get_user(target_user_id) {
            Some(user) => Ok(WorkspaceProtocolResponse::Member(user)),
            None => Err(NetworkError::msg(format!(
                "Target user '{}' not found.",
                target_user_id
            ))),
        }
    }

    fn update_member_role_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        // This will call a new method in domain_ops, e.g., update_workspace_member_role
        // The actual error "Failed to update member role: User X not found" will come from domain_ops.
        self.domain_ops().update_workspace_member_role(
            actor_user_id,
            target_user_id,
            role,
            metadata,
        )
    }

    fn update_member_permissions_command_internal(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.domain_ops().update_member_permissions(
            actor_user_id,
            target_user_id,
            domain_id,
            permissions,
            operation,
        )
    }
}
