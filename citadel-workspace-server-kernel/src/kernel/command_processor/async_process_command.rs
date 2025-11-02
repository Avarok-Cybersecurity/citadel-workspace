//! # Async Command Processing
//!
//! This module provides the async command processing for AsyncWorkspaceServerKernel

use crate::handlers::domain::async_ops::AsyncWorkspaceOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Office;

/// Process a command asynchronously with a specific user context
pub async fn process_command_with_user<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    command: &WorkspaceProtocolRequest,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    println!("[ASYNC_PROCESS_COMMAND] Processing command: {command:?} for user: {actor_user_id}");

    match command {
        // Workspace Commands
        WorkspaceProtocolRequest::GetWorkspace => {
            println!(
                "[ASYNC_PROCESS_COMMAND] GetWorkspace for user: {}",
                actor_user_id
            );
            match kernel
                .domain_ops()
                .get_workspace(&actor_user_id, crate::WORKSPACE_ROOT_ID)
                .await
            {
                Ok(workspace) => {
                    println!(
                        "[ASYNC_PROCESS_COMMAND] Workspace found: {:?}",
                        workspace.id
                    );
                    Ok(WorkspaceProtocolResponse::Workspace(workspace))
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    println!("[ASYNC_PROCESS_COMMAND] GetWorkspace error: {}", error_msg);
                    if error_msg.contains("not found") || error_msg.contains("Not a member") {
                        println!("[ASYNC_PROCESS_COMMAND] Returning WorkspaceNotInitialized");
                        Ok(WorkspaceProtocolResponse::WorkspaceNotInitialized)
                    } else {
                        Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to get workspace: {}",
                            e
                        )))
                    }
                }
            }
        }

        WorkspaceProtocolRequest::CreateWorkspace {
            name,
            description,
            metadata,
            workspace_master_password,
        } => {
            match kernel
                .domain_ops()
                .create_workspace(
                    actor_user_id,
                    name,
                    description,
                    metadata.clone(),
                    workspace_master_password.clone(),
                )
                .await
            {
                Ok(workspace) => Ok(WorkspaceProtocolResponse::Workspace(workspace)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create workspace: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateWorkspace {
            name,
            description,
            metadata,
            workspace_master_password,
        } => {
            match kernel
                .domain_ops()
                .update_workspace(
                    actor_user_id,
                    crate::WORKSPACE_ROOT_ID,
                    name.as_deref(),
                    description.as_deref(),
                    metadata.clone(),
                    workspace_master_password.clone(),
                )
                .await
            {
                Ok(workspace) => Ok(WorkspaceProtocolResponse::Workspace(workspace)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update workspace: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::DeleteWorkspace {
            workspace_master_password,
        } => {
            match kernel
                .domain_ops()
                .delete_workspace(
                    actor_user_id,
                    crate::WORKSPACE_ROOT_ID,
                    workspace_master_password.clone(),
                )
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Workspace deleted successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to delete workspace: {}",
                    e
                ))),
            }
        }

        // Office Commands
        WorkspaceProtocolRequest::CreateOffice {
            workspace_id,
            name,
            description,
            mdx_content,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncOfficeOperations;
            match kernel
                .domain_ops()
                .create_office(
                    actor_user_id,
                    workspace_id,
                    name,
                    description,
                    mdx_content.as_deref(),
                )
                .await
            {
                Ok(office) => Ok(WorkspaceProtocolResponse::Office(office)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create office: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetOffice { office_id } => {
            use crate::handlers::domain::async_ops::AsyncOfficeOperations;
            match kernel
                .domain_ops()
                .get_office(actor_user_id, office_id)
                .await
            {
                Ok(office_json) => {
                    // Parse the JSON string back to Office struct
                    match serde_json::from_str::<Office>(&office_json) {
                        Ok(office) => Ok(WorkspaceProtocolResponse::Office(office)),
                        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to parse office: {}",
                            e
                        ))),
                    }
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get office: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateOffice {
            office_id,
            name,
            description,
            mdx_content,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncOfficeOperations;
            match kernel
                .domain_ops()
                .update_office(
                    actor_user_id,
                    office_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                )
                .await
            {
                Ok(office) => Ok(WorkspaceProtocolResponse::Office(office)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update office: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::DeleteOffice { office_id } => {
            use crate::handlers::domain::async_ops::AsyncOfficeOperations;
            match kernel
                .domain_ops()
                .delete_office(actor_user_id, office_id)
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Office deleted successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to delete office: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::ListOffices => {
            use crate::handlers::domain::async_ops::AsyncOfficeOperations;
            match kernel.domain_ops().list_offices(&actor_user_id, None).await {
                Ok(offices) => Ok(WorkspaceProtocolResponse::Offices(offices)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to list offices: {}",
                    e
                ))),
            }
        }

        // Room Commands
        WorkspaceProtocolRequest::CreateRoom {
            office_id,
            name,
            description,
            mdx_content,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel
                .domain_ops()
                .create_room(
                    actor_user_id,
                    office_id,
                    name,
                    description,
                    mdx_content.as_deref(),
                )
                .await
            {
                Ok(room) => Ok(WorkspaceProtocolResponse::Room(room)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create room: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetRoom { room_id } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel.domain_ops().get_room(actor_user_id, room_id).await {
                Ok(room) => Ok(WorkspaceProtocolResponse::Room(room)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get room: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateRoom {
            room_id,
            name,
            description,
            mdx_content,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel
                .domain_ops()
                .update_room(
                    actor_user_id,
                    room_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                )
                .await
            {
                Ok(room) => Ok(WorkspaceProtocolResponse::Room(room)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update room: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::DeleteRoom { room_id } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel
                .domain_ops()
                .delete_room(actor_user_id, room_id)
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Room deleted successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to delete room: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::ListRooms { office_id } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel
                .domain_ops()
                .list_rooms(actor_user_id, Some(office_id.clone()))
                .await
            {
                Ok(rooms) => Ok(WorkspaceProtocolResponse::Rooms(rooms)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to list rooms: {}",
                    e
                ))),
            }
        }

        // Member Commands
        WorkspaceProtocolRequest::AddMember {
            user_id,
            office_id,
            room_id,
            role,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            // Determine the domain_id based on room_id or office_id
            let domain_id = if let Some(room_id) = room_id {
                room_id.clone()
            } else if let Some(office_id) = office_id {
                office_id.clone()
            } else {
                crate::WORKSPACE_ROOT_ID.to_string()
            };

            match kernel
                .domain_ops()
                .add_user_to_domain(actor_user_id, user_id, &domain_id, role.clone())
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Member added successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to add member: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetMember { user_id } => {
            // Get member returns the user if they exist
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_user(user_id)
                .await
            {
                Ok(Some(user)) => Ok(WorkspaceProtocolResponse::Member(user)),
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "Member not found".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get member: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateMemberRole {
            user_id,
            role,
            metadata,
        } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            match kernel
                .domain_ops()
                .update_workspace_member_role(
                    actor_user_id,
                    user_id,
                    role.clone(),
                    metadata.clone(),
                )
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Member role updated successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update member role: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateMemberPermissions {
            user_id,
            domain_id,
            permissions,
            operation,
        } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            match kernel
                .domain_ops()
                .update_member_permissions(
                    actor_user_id,
                    user_id,
                    domain_id,
                    permissions.clone(),
                    operation.clone(),
                )
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Member permissions updated successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update member permissions: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::RemoveMember {
            user_id,
            office_id,
            room_id,
        } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            // Determine the domain_id based on room_id or office_id
            let domain_id = if let Some(room_id) = room_id {
                room_id.clone()
            } else if let Some(office_id) = office_id {
                office_id.clone()
            } else {
                crate::WORKSPACE_ROOT_ID.to_string()
            };

            match kernel
                .domain_ops()
                .remove_user_from_domain(actor_user_id, user_id, &domain_id)
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    "Member removed successfully".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to remove member: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::ListMembers { office_id, room_id } => {
            // Validate parameters - must specify exactly one of office_id or room_id
            match (office_id, room_id) {
                (Some(_), Some(_)) => Ok(WorkspaceProtocolResponse::Error(
                    "Must specify exactly one of office_id or room_id".to_string(),
                )),
                (None, None) => Ok(WorkspaceProtocolResponse::Error(
                    "Must specify exactly one of office_id or room_id".to_string(),
                )),
                (Some(office_id), None) => {
                    // Get the office domain and extract member IDs
                    match kernel
                        .domain_operations
                        .backend_tx_manager
                        .get_domain(office_id)
                        .await
                    {
                        Ok(Some(domain)) => {
                            let member_ids = domain.members().clone();
                            // Get full user objects for each member ID
                            let mut users = Vec::new();
                            for user_id in member_ids {
                                if let Ok(Some(user)) = kernel
                                    .domain_operations
                                    .backend_tx_manager
                                    .get_user(&user_id)
                                    .await
                                {
                                    users.push(user);
                                }
                            }
                            Ok(WorkspaceProtocolResponse::Members(users))
                        }
                        Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                            "Office not found".to_string(),
                        )),
                        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to list members: {e}"
                        ))),
                    }
                }
                (None, Some(room_id)) => {
                    // Get the room domain and extract member IDs
                    match kernel
                        .domain_operations
                        .backend_tx_manager
                        .get_domain(room_id)
                        .await
                    {
                        Ok(Some(domain)) => {
                            let member_ids = domain.members().clone();
                            // Get full user objects for each member ID
                            let mut users = Vec::new();
                            for user_id in member_ids {
                                if let Ok(Some(user)) = kernel
                                    .domain_operations
                                    .backend_tx_manager
                                    .get_user(&user_id)
                                    .await
                                {
                                    users.push(user);
                                }
                            }
                            Ok(WorkspaceProtocolResponse::Members(users))
                        }
                        Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                            "Room not found".to_string(),
                        )),
                        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to list members: {e}"
                        ))),
                    }
                }
            }
        }

        // Message command is not supported by server
        WorkspaceProtocolRequest::Message { .. } => Ok(WorkspaceProtocolResponse::Error(
            "Message command is not supported by server. Only peers may receive this type"
                .to_string(),
        )),
    }
}
