//! # Async Command Processing
//!
//! This module provides the async command processing for AsyncWorkspaceServerKernel

use crate::handlers::domain::async_ops::AsyncWorkspaceOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, NodeEntityType, Office, Room, WorkspaceMetadata};
use std::time::{SystemTime, UNIX_EPOCH};

/// Convert an Office to a generic DomainNode
fn office_to_domain_node(office: Office, parent_id: Option<String>) -> DomainNode {
    DomainNode {
        id: office.id,
        parent_id: parent_id.or(Some("workspace-root".to_string())),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth: 1,
        name: office.name,
        description: office.description,
        owner_id: office.owner_id,
        members: office.members,
        children: office.rooms,
        mdx_content: office.mdx_content,
        rules: office.rules,
        chat_enabled: office.chat_enabled,
        chat_channel_id: office.chat_channel_id,
        default_permissions: office.default_permissions,
        metadata: office.metadata,
        allowed_child_types: Some(vec!["Room".to_string()]),
        is_default: office.is_default,
        created_at: 0, // Office struct doesn't have timestamps, use 0
        updated_at: 0,
    }
}

/// Convert a Room to a generic DomainNode
fn room_to_domain_node(room: Room, parent_id: String) -> DomainNode {
    // Convert Vec<MetadataField> to Vec<u8> via serialization
    let metadata = serde_json::to_vec(&room.metadata).unwrap_or_default();

    DomainNode {
        id: room.id,
        parent_id: Some(parent_id),
        entity_type: NodeEntityType::Child("Room".to_string()),
        depth: 2,
        name: room.name,
        description: room.description,
        owner_id: room.owner_id,
        members: room.members,
        children: vec![],
        mdx_content: room.mdx_content,
        rules: room.rules,
        chat_enabled: room.chat_enabled,
        chat_channel_id: room.chat_channel_id,
        default_permissions: room.default_permissions,
        metadata,
        allowed_child_types: None, // Rooms are leaf nodes
        is_default: false, // Room struct doesn't have is_default field
        created_at: 0, // Room struct doesn't have timestamps, use 0
        updated_at: 0,
    }
}

/// Process a command asynchronously with a specific user context
///
/// The `requester_cid` is used to exclude the requester from broadcast messages
pub async fn process_command_with_user<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    command: &WorkspaceProtocolRequest,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    process_command_with_user_and_cid(kernel, command, actor_user_id, None).await
}

/// Process a command asynchronously with a specific user context and CID for broadcast exclusion
pub async fn process_command_with_user_and_cid<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    command: &WorkspaceProtocolRequest,
    actor_user_id: &str,
    requester_cid: Option<u64>,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    println!("[ASYNC_PROCESS_COMMAND] Processing command: {command:?} for user: {actor_user_id}");

    match command {
        // Workspace Commands
        WorkspaceProtocolRequest::GetWorkspace { workspace_id } => {
            let target_id = workspace_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);
            println!(
                "[ASYNC_PROCESS_COMMAND] GetWorkspace({}) for user: {}",
                target_id, actor_user_id
            );
            match kernel
                .domain_ops()
                .get_workspace(actor_user_id, target_id)
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

        WorkspaceProtocolRequest::ListWorkspaces => {
            println!(
                "[ASYNC_PROCESS_COMMAND] ListWorkspaces for user: {}",
                actor_user_id
            );
            match kernel
                .domain_ops()
                .list_workspaces(actor_user_id)
                .await
            {
                Ok(workspaces) => {
                    println!(
                        "[ASYNC_PROCESS_COMMAND] Found {} accessible workspaces",
                        workspaces.len()
                    );
                    let metadata: Vec<WorkspaceMetadata> =
                        workspaces.iter().map(WorkspaceMetadata::from).collect();
                    Ok(WorkspaceProtocolResponse::Workspaces(metadata))
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to list workspaces: {}",
                    e
                ))),
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
            workspace_id,
            name,
            description,
            metadata,
            workspace_master_password,
        } => {
            let target_id = workspace_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);
            match kernel
                .domain_ops()
                .update_workspace(
                    actor_user_id,
                    target_id,
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
            workspace_id,
            workspace_master_password,
        } => {
            let target_id = workspace_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);
            match kernel
                .domain_ops()
                .delete_workspace(
                    actor_user_id,
                    target_id,
                    workspace_master_password.clone(),
                )
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(
                    String::from("Workspace deleted successfully"),
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
            metadata: _,
            is_default,
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
                    *is_default,
                )
                .await
            {
                Ok(office) => {
                    let node = office_to_domain_node(office, Some(workspace_id.clone()));
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
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
                        Ok(office) => {
                            let parent_id = Some(office.workspace_id.clone());
                            let node = office_to_domain_node(office, parent_id);
                            Ok(WorkspaceProtocolResponse::Node(node))
                        }
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
            metadata: _,
            is_default,
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
                    *is_default,
                )
                .await
            {
                Ok(office) => {
                    // If mdx_content was updated, broadcast to other clients and persist to file
                    if let Some(content) = mdx_content {
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        let broadcast_response = WorkspaceProtocolResponse::OfficeContentUpdated {
                            office_id: office_id.clone(),
                            mdx_content: content.clone(),
                            updated_by: actor_user_id.to_string(),
                            timestamp,
                        };

                        kernel.broadcast(broadcast_response, requester_cid);
                        println!(
                            "[ASYNC_PROCESS_COMMAND] Broadcast OfficeContentUpdated for office {}",
                            office_id
                        );

                        // Persist to file (non-blocking, log errors but don't fail)
                        if let Err(e) = kernel.persist_office_content(&office.name, content).await {
                            println!("[ASYNC_PROCESS_COMMAND] Warning: Failed to persist office content: {}", e);
                        }
                    }

                    let parent_id = Some(office.workspace_id.clone());
                    let node = office_to_domain_node(office, parent_id);
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
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
            match kernel.domain_ops().list_offices(actor_user_id, None).await {
                Ok(offices) => {
                    let nodes: Vec<DomainNode> = offices
                        .into_iter()
                        .map(|office| {
                            let parent_id = Some(office.workspace_id.clone());
                            office_to_domain_node(office, parent_id)
                        })
                        .collect();
                    Ok(WorkspaceProtocolResponse::Nodes(nodes))
                }
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
            metadata: _,
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
                Ok(room) => {
                    let node = room_to_domain_node(room, office_id.clone());
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create room: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetRoom { room_id } => {
            use crate::handlers::domain::async_ops::AsyncRoomOperations;
            match kernel.domain_ops().get_room(actor_user_id, room_id).await {
                Ok(room) => {
                    let parent_id = room.office_id.clone();
                    let node = room_to_domain_node(room, parent_id);
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
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
            metadata: _,
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
                Ok(room) => {
                    // If mdx_content was updated, broadcast to other clients and persist to file
                    if let Some(content) = mdx_content {
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        let broadcast_response = WorkspaceProtocolResponse::RoomContentUpdated {
                            room_id: room_id.clone(),
                            office_id: room.office_id.clone(),
                            mdx_content: content.clone(),
                            updated_by: actor_user_id.to_string(),
                            timestamp,
                        };

                        kernel.broadcast(broadcast_response, requester_cid);
                        println!(
                            "[ASYNC_PROCESS_COMMAND] Broadcast RoomContentUpdated for room {}",
                            room_id
                        );

                        // Persist to file (need to look up office name first)
                        if let Ok(Some(citadel_workspace_types::structs::Domain::Office {
                            office,
                        })) = kernel.get_domain(&room.office_id).await
                        {
                            if let Err(e) = kernel
                                .persist_room_content(&office.name, &room.name, content)
                                .await
                            {
                                println!(
                                    "[ASYNC_PROCESS_COMMAND] Warning: Failed to persist room content: {}",
                                    e
                                );
                            }
                        }
                    }

                    let parent_id = room.office_id.clone();
                    let node = room_to_domain_node(room, parent_id);
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
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
                Ok(rooms) => {
                    let nodes: Vec<DomainNode> = rooms
                        .into_iter()
                        .map(|room| {
                            let parent_id = room.office_id.clone();
                            room_to_domain_node(room, parent_id)
                        })
                        .collect();
                    Ok(WorkspaceProtocolResponse::Nodes(nodes))
                }
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
            metadata: _,
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

        WorkspaceProtocolRequest::UpdateUserProfile { name, avatar_data } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            match kernel
                .domain_ops()
                .update_user_profile(actor_user_id, name.clone(), avatar_data.clone())
                .await
            {
                Ok(user) => Ok(WorkspaceProtocolResponse::UserProfileUpdated(user)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update user profile: {}",
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
                kernel
                    .domain_ops()
                    .is_admin(actor_user_id)
                    .await
                    .unwrap_or(false)
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
            use citadel_workspace_types::GroupMessage;
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
                    // Create the notification and broadcast to all connected clients
                    let notification = WorkspaceProtocolResponse::GroupMessageNotification {
                        group_id: group_id.clone(),
                        message: message.clone(),
                    };
                    // Broadcast to all clients except the sender
                    kernel.broadcast(notification.clone(), requester_cid);
                    Ok(notification)
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
                    let is_admin = kernel
                        .domain_ops()
                        .is_admin(actor_user_id)
                        .await
                        .unwrap_or(false);
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
                        Ok(Some(_)) => {
                            let notification = WorkspaceProtocolResponse::GroupMessageEdited {
                                group_id: group_id.clone(),
                                message_id: message_id.clone(),
                                new_content: new_content.clone(),
                                edited_at,
                            };
                            // Broadcast to all clients except the sender
                            kernel.broadcast(notification.clone(), requester_cid);
                            Ok(notification)
                        }
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
                    let is_admin = kernel
                        .domain_ops()
                        .is_admin(actor_user_id)
                        .await
                        .unwrap_or(false);
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
                        Ok(Some(_)) => {
                            let notification = WorkspaceProtocolResponse::GroupMessageDeleted {
                                group_id: group_id.clone(),
                                message_id: message_id.clone(),
                                deleted_by: actor_user_id.to_string(),
                            };
                            // Broadcast to all clients except the sender
                            kernel.broadcast(notification.clone(), requester_cid);
                            Ok(notification)
                        }
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

        // ========== Server Capabilities ==========
        WorkspaceProtocolRequest::GetServerCapabilities => {
            let config = kernel.file_transfer_config();
            Ok(WorkspaceProtocolResponse::ServerCapabilities {
                allow_server_file_transfer: config.allow_server_file_transfer,
                allow_server_revfs_storage: config.allow_server_revfs_storage,
                max_file_transfer_size_mb: config.max_file_transfer_size_mb,
                revfs_storage_quota_mb: config.revfs_storage_quota_mb,
            })
        }

        // ========== Tree Node Operations (Generalized Hierarchy) ==========
        // These handlers support the generalized workspace tree structure
        // where any node can have child nodes of any type

        WorkspaceProtocolRequest::CreateNode {
            parent_id,
            entity_type,
            name,
            description,
        } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .create_node(
                    actor_user_id,
                    parent_id.as_deref(),
                    entity_type,
                    name,
                    description,
                )
                .await
            {
                Ok(node) => Ok(WorkspaceProtocolResponse::Node(node)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetNode { node_id } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .get_node(actor_user_id, node_id)
                .await
            {
                Ok(node) => Ok(WorkspaceProtocolResponse::Node(node)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateNode {
            node_id,
            name,
            description,
            mdx_content,
            rules,
            chat_enabled,
        } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .update_node(
                    actor_user_id,
                    node_id,
                    name.as_deref(),
                    description.as_deref(),
                    mdx_content.as_deref(),
                    rules.as_deref(),
                    *chat_enabled,
                )
                .await
            {
                Ok(node) => Ok(WorkspaceProtocolResponse::Node(node)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::DeleteNode { node_id, cascade } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .delete_node(actor_user_id, node_id, *cascade)
                .await
            {
                Ok(deleted_ids) => Ok(WorkspaceProtocolResponse::NodeDeleted {
                    node_id: node_id.clone(),
                    children_deleted: deleted_ids
                        .into_iter()
                        .filter(|id| id != node_id)
                        .collect(),
                }),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to delete node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::MoveNode {
            node_id,
            new_parent_id,
        } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            // Get the old parent before moving
            let old_parent_id = match kernel.domain_ops().get_node(actor_user_id, node_id).await {
                Ok(node) => node.parent_id,
                Err(_) => None,
            };
            match kernel
                .domain_ops()
                .move_node(actor_user_id, node_id, new_parent_id.as_deref())
                .await
            {
                Ok(node) => {
                    Ok(WorkspaceProtocolResponse::NodeMoved {
                        node_id: node_id.clone(),
                        old_parent_id,
                        new_parent_id: node.parent_id,
                    })
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to move node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::ListNodes {
            parent_id,
            depth,
            entity_types,
        } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .list_nodes(
                    actor_user_id,
                    parent_id.as_deref(),
                    *depth,
                    entity_types.as_deref(),
                )
                .await
            {
                Ok(nodes) => Ok(WorkspaceProtocolResponse::Nodes(nodes)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to list nodes: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetTreeStructure { root_id, max_depth } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel
                .domain_ops()
                .get_tree_structure(actor_user_id, root_id.as_deref(), *max_depth)
                .await
            {
                Ok(tree) => Ok(WorkspaceProtocolResponse::TreeStructure { root: tree }),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get tree structure: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetTreeSchema => {
            // Get the schema from backend, returning default if not set
            match kernel
                .domain_operations
                .backend_tx_manager
                .get_tree_schema_or_default()
                .await
            {
                Ok(schema) => Ok(WorkspaceProtocolResponse::TreeSchema(schema)),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to get tree schema: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::UpdateTreeSchema { schema } => {
            use crate::handlers::domain::async_ops::AsyncDomainOperations;
            // Check if user is admin
            let is_admin = kernel.domain_ops().is_admin(actor_user_id).await.unwrap_or(false);
            if !is_admin {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Permission denied: Only admins can update tree schema".to_string(),
                ));
            }

            match kernel
                .domain_operations
                .backend_tx_manager
                .save_tree_schema(schema)
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::TreeSchema(schema.clone())),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update tree schema: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::CreateNodeType {
            name,
            display_name,
            icon,
            allowed_parents,
        } => {
            use crate::handlers::domain::async_ops::AsyncDomainOperations;
            use citadel_workspace_types::structs::CustomNodeType;

            // Check if user has ManageNodeTypes permission
            let is_admin = kernel.domain_ops().is_admin(actor_user_id).await.unwrap_or(false);
            if !is_admin {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Permission denied: Only admins can create custom node types".to_string(),
                ));
            }

            // Create the custom node type
            let node_type = CustomNodeType {
                name: name.clone(),
                display_name: display_name.clone(),
                icon: icon.clone(),
                allowed_parents: allowed_parents.clone(),
            };

            // For now, custom node types are stored in the tree schema's rules
            // Update the schema to include this new type
            let mut schema = kernel
                .domain_operations
                .backend_tx_manager
                .get_tree_schema_or_default()
                .await?;

            // Add nesting rules for this new type
            use citadel_workspace_types::structs::NestingRule;
            for parent_type in allowed_parents {
                // Find or create rule for each allowed parent
                if let Some(rule) = schema.rules.iter_mut().find(|r| &r.parent_type == parent_type) {
                    if !rule.allowed_child_types.contains(name) {
                        rule.allowed_child_types.push(name.clone());
                    }
                } else {
                    schema.rules.push(NestingRule {
                        parent_type: parent_type.clone(),
                        allowed_child_types: vec![name.clone()],
                    });
                }
            }

            // Save the updated schema
            kernel
                .domain_operations
                .backend_tx_manager
                .save_tree_schema(&schema)
                .await?;

            // Return the list of node types including the new one
            Ok(WorkspaceProtocolResponse::NodeTypes(vec![node_type]))
        }

        WorkspaceProtocolRequest::ListNodeTypes => {
            use citadel_workspace_types::structs::CustomNodeType;

            // Get the schema to extract node types
            let schema = kernel
                .domain_operations
                .backend_tx_manager
                .get_tree_schema_or_default()
                .await?;

            // Extract all unique node types from the schema rules
            let mut node_types = Vec::new();
            let mut seen_types = std::collections::HashSet::new();

            // Add built-in types
            let builtin_types = vec![
                CustomNodeType {
                    name: "Workspace".to_string(),
                    display_name: "Workspace".to_string(),
                    icon: None,
                    allowed_parents: vec![], // Root only
                },
                CustomNodeType {
                    name: "Office".to_string(),
                    display_name: "Office".to_string(),
                    icon: None,
                    allowed_parents: vec!["Workspace".to_string()],
                },
                CustomNodeType {
                    name: "Room".to_string(),
                    display_name: "Room".to_string(),
                    icon: None,
                    allowed_parents: vec!["Office".to_string()],
                },
            ];

            for bt in builtin_types {
                seen_types.insert(bt.name.clone());
                node_types.push(bt);
            }

            // Add custom types from schema
            for rule in &schema.rules {
                for child_type in &rule.allowed_child_types {
                    if !seen_types.contains(child_type) {
                        seen_types.insert(child_type.clone());
                        node_types.push(CustomNodeType {
                            name: child_type.clone(),
                            display_name: child_type.clone(),
                            icon: None,
                            allowed_parents: vec![rule.parent_type.clone()],
                        });
                    }
                }
            }

            Ok(WorkspaceProtocolResponse::NodeTypes(node_types))
        }
    }
}
