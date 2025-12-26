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
                Ok(_) => Ok(WorkspaceProtocolResponse::DeleteOffice {
                    office_id: office_id.clone(),
                }),
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
                Ok(_) => Ok(WorkspaceProtocolResponse::DeleteRoom {
                    room_id: room_id.clone(),
                }),
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
                Ok(_) => Ok(WorkspaceProtocolResponse::MemberRoleUpdated {
                    user_id: user_id.clone(),
                    new_role: role.clone(),
                }),
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

        WorkspaceProtocolRequest::GetUserPermissions { user_id, domain_id } => {
            use citadel_workspace_types::structs::Permission;

            // Check if requester has permission to view (must be admin or requesting own permissions)
            let is_admin = {
                use crate::handlers::domain::async_ops::AsyncDomainOperations;
                kernel.domain_ops().is_admin(actor_user_id).await.unwrap_or(false)
            };

            if actor_user_id != user_id && !is_admin {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Permission denied: Can only view own permissions or must be admin".to_string(),
                ));
            }

            // Get the user
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_user(user_id)
                .await
            {
                Ok(Some(user)) => {
                    // Get permissions for the specific domain
                    let permissions: Vec<Permission> = user
                        .get_permissions(domain_id)
                        .map(|p| p.iter().cloned().collect())
                        .unwrap_or_default();

                    Ok(WorkspaceProtocolResponse::UserPermissions {
                        domain_id: domain_id.clone(),
                        user_id: user_id.clone(),
                        role: user.role.clone(),
                        permissions,
                    })
                }
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "User not found".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get user: {}",
                    e
                ))),
            }
        }

        // Message command is not supported by server
        WorkspaceProtocolRequest::Message { .. } => Ok(WorkspaceProtocolResponse::Error(
            "Message command is not supported by server. Only peers may receive this type"
                .to_string(),
        )),

        // ========== Group Messaging Commands ==========

        WorkspaceProtocolRequest::SendGroupMessage {
            group_id,
            message_type,
            content,
            reply_to,
            mentions,
        } => {
            use citadel_workspace_types::{GroupMessage, GroupMessageType};
            use uuid::Uuid;

            // Get sender name from user
            let sender_name = match kernel
                .domain_operations
                .backend_tx_manager
                .get_user(actor_user_id)
                .await
            {
                Ok(Some(user)) => user.name,
                _ => actor_user_id.to_string(),
            };

            // Create the message
            let message = GroupMessage {
                id: Uuid::new_v4().to_string(),
                group_id: group_id.clone(),
                sender_id: actor_user_id.to_string(),
                sender_name,
                message_type: message_type.clone(),
                content: content.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64,
                reply_to: reply_to.clone(),
                reply_count: 0,
                mentions: mentions.clone().unwrap_or_default(),
                edited_at: None,
            };

            // Store the message
            match kernel
                .domain_operations
                .backend_tx_manager
                .store_group_message(message.clone())
                .await
            {
                Ok(_) => {
                    // Return the notification so it can be broadcast
                    Ok(WorkspaceProtocolResponse::GroupMessageNotification {
                        group_id: group_id.clone(),
                        message,
                    })
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to send message: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::EditGroupMessage {
            group_id,
            message_id,
            new_content,
        } => {
            // Get the original message to verify ownership
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_group_message(group_id, message_id)
                .await
            {
                Ok(Some(msg)) => {
                    // Check if user is sender or admin
                    use crate::handlers::domain::async_ops::AsyncDomainOperations;
                    let is_admin = kernel.domain_ops().is_admin(actor_user_id).await.unwrap_or(false);
                    if msg.sender_id != actor_user_id && !is_admin {
                        return Ok(WorkspaceProtocolResponse::Error(
                            "Permission denied: Can only edit own messages".to_string(),
                        ));
                    }

                    let edited_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    match kernel
                        .domain_operations
                        .backend_tx_manager
                        .update_group_message(group_id, message_id, new_content.clone(), edited_at)
                        .await
                    {
                        Ok(Some(_)) => Ok(WorkspaceProtocolResponse::GroupMessageEdited {
                            group_id: group_id.clone(),
                            message_id: message_id.clone(),
                            new_content: new_content.clone(),
                            edited_at,
                        }),
                        Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                            "Message not found".to_string(),
                        )),
                        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to edit message: {}",
                            e
                        ))),
                    }
                }
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "Message not found".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get message: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::DeleteGroupMessage {
            group_id,
            message_id,
        } => {
            // Get the original message to verify ownership
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_group_message(group_id, message_id)
                .await
            {
                Ok(Some(msg)) => {
                    // Check if user is sender or admin
                    use crate::handlers::domain::async_ops::AsyncDomainOperations;
                    let is_admin = kernel.domain_ops().is_admin(actor_user_id).await.unwrap_or(false);
                    if msg.sender_id != actor_user_id && !is_admin {
                        return Ok(WorkspaceProtocolResponse::Error(
                            "Permission denied: Can only delete own messages".to_string(),
                        ));
                    }

                    match kernel
                        .domain_operations
                        .backend_tx_manager
                        .delete_group_message(group_id, message_id)
                        .await
                    {
                        Ok(Some(_)) => Ok(WorkspaceProtocolResponse::GroupMessageDeleted {
                            group_id: group_id.clone(),
                            message_id: message_id.clone(),
                            deleted_by: actor_user_id.to_string(),
                        }),
                        Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                            "Message not found".to_string(),
                        )),
                        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                            "Failed to delete message: {}",
                            e
                        ))),
                    }
                }
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "Message not found".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get message: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetGroupMessages {
            group_id,
            before_timestamp,
            limit,
        } => {
            let limit = limit.unwrap_or(50).min(100); // Default 50, max 100

            match kernel
                .domain_operations
                .backend_tx_manager
                .get_group_messages_paginated(group_id, *before_timestamp, limit)
                .await
            {
                Ok((messages, has_more)) => Ok(WorkspaceProtocolResponse::GroupMessages {
                    group_id: group_id.clone(),
                    messages,
                    has_more,
                }),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get messages: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetThreadMessages {
            group_id,
            parent_message_id,
        } => {
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_thread_messages(group_id, parent_message_id)
                .await
            {
                Ok(messages) => Ok(WorkspaceProtocolResponse::GroupMessages {
                    group_id: group_id.clone(),
                    messages,
                    has_more: false, // Thread messages are always returned fully
                }),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get thread messages: {}",
                    e
                ))),
            }
        }
    }
}
