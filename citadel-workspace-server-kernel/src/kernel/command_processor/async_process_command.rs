//! # Async Command Processing
//!
//! This module provides the async command processing for AsyncWorkspaceServerKernel

use crate::handlers::domain::async_ops::AsyncWorkspaceOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use citadel_logging::{debug, info, warn};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::WorkspaceMetadata;

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
    debug!(target: "citadel", "Processing command: {command:?} for user: {actor_user_id}");

    match command {
        // Workspace Commands
        WorkspaceProtocolRequest::GetWorkspace { workspace_id } => {
            let target_id = workspace_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);
            debug!(target: "citadel", "GetWorkspace({}) for user: {}", target_id, actor_user_id);
            match kernel
                .domain_ops()
                .get_workspace(actor_user_id, target_id)
                .await
            {
                Ok(workspace) => {
                    debug!(target: "citadel", "Workspace found: {:?}", workspace.id);
                    Ok(WorkspaceProtocolResponse::Workspace(workspace))
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    warn!(target: "citadel", "GetWorkspace error: {}", error_msg);
                    if error_msg.contains("not found") || error_msg.contains("Not a member") {
                        info!(target: "citadel", "Returning WorkspaceNotInitialized");
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
            debug!(target: "citadel", "ListWorkspaces for user: {}", actor_user_id);
            match kernel.domain_ops().list_workspaces(actor_user_id).await {
                Ok(workspaces) => {
                    debug!(target: "citadel", "Found {} accessible workspaces", workspaces.len());
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

        WorkspaceProtocolRequest::UpdateWorkspaceTheme {
            workspace_id,
            theme,
        } => {
            use citadel_workspace_types::structs::Permission;

            let target_id = workspace_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);

            // Gated on Permission::Themes rather than the master password: this
            // changes how the workspace looks, not what it is, so it must not
            // require the credential that also permits deleting it.
            let allowed = {
                use crate::handlers::domain::async_ops::AsyncPermissionOperations;
                kernel
                    .domain_operations
                    .check_entity_permission(actor_user_id, target_id, Permission::Themes)
                    .await
                    .unwrap_or(false)
            };

            if !allowed {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Permission denied: Themes required".to_string(),
                ));
            }

            // Held across the whole read-modify-write below. A workspace is
            // stored whole, so without this a concurrent member or settings
            // update reads the same record, and whichever writes second
            // discards the other's field.
            let _workspace_guard = kernel
                .domain_operations
                .backend_tx_manager
                .lock_workspaces()
                .await;

            match kernel
                .domain_operations
                .backend_tx_manager
                .get_workspace(target_id)
                .await
            {
                Ok(Some(mut workspace)) => {
                    // Merge, do not replace: `metadata` is one JSON object
                    // that several features share, and assigning over it erased
                    // the initialisation marker, so an initialised workspace
                    // came back looking unconfigured and the setup modal opened
                    // over a working workspace and blocked every click behind
                    // its backdrop. The rule now lives in one place so the next
                    // writer inherits it instead of rediscovering this.
                    let patch = serde_json::json!({ "theme": match serde_json::from_slice::<serde_json::Value>(theme) {
                        Ok(value) => value,
                        Err(e) => {
                            return Ok(WorkspaceProtocolResponse::Error(format!(
                                "Theme payload is not valid JSON: {}",
                                e
                            )))
                        }
                    } });
                    let patch_bytes = match serde_json::to_vec(&patch) {
                        Ok(bytes) => bytes,
                        Err(e) => {
                            return Ok(WorkspaceProtocolResponse::Error(format!(
                                "Failed to encode theme patch: {}",
                                e
                            )))
                        }
                    };
                    workspace.metadata = match crate::handlers::domain::server_ops::metadata_merge::merge_metadata_document(
                        &workspace.metadata,
                        &patch_bytes,
                    ) {
                        Ok(bytes) => bytes,
                        Err(e) => return Ok(WorkspaceProtocolResponse::Error(e)),
                    };
                    kernel
                        .domain_operations
                        .backend_tx_manager
                        .insert_workspace(target_id.to_string(), workspace.clone())
                        .await?;

                    // The denormalized copy, which every other workspace
                    // mutator also writes. Updating only the workspace record
                    // left the Domain::Workspace copy holding the previous
                    // metadata, so a reader that goes through the domain saw
                    // the old theme and would eventually write it back.
                    kernel
                        .domain_operations
                        .backend_tx_manager
                        .insert_domain(
                            target_id.to_string(),
                            citadel_workspace_types::structs::Domain::Workspace {
                                workspace: workspace.clone(),
                            },
                        )
                        .await?;

                    Ok(WorkspaceProtocolResponse::Workspace(workspace))
                }
                Ok(None) => Ok(WorkspaceProtocolResponse::Error(
                    "Workspace not found".to_string(),
                )),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to update workspace theme: {}",
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
                .delete_workspace(actor_user_id, target_id, workspace_master_password.clone())
                .await
            {
                Ok(_) => Ok(WorkspaceProtocolResponse::Success(String::from(
                    "Workspace deleted successfully",
                ))),
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to delete workspace: {}",
                    e
                ))),
            }
        }

        // Member Commands
        WorkspaceProtocolRequest::AddMember {
            user_id,
            domain_id,
            role,
            metadata: _,
        } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            let domain_id = domain_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);

            match kernel
                .domain_ops()
                .add_user_to_domain(actor_user_id, user_id, domain_id, role.clone())
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
            // A `User` carries the role, the FULL per-domain permissions map and
            // the metadata, and this had no check at all — so any authenticated
            // account could enumerate every other account and read the entire
            // enforced permission state of the workspace. `GetUserPermissions`,
            // fifteen lines below, already gates exactly this data correctly;
            // the same rule applies here.
            {
                use crate::handlers::domain::async_ops::AsyncDomainOperations;
                let is_admin = kernel
                    .domain_ops()
                    .is_admin(actor_user_id)
                    .await
                    .unwrap_or(false);
                if actor_user_id != user_id && !is_admin {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Permission denied: Can only view your own member record or must be admin"
                            .to_string(),
                    ));
                }
            }

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

        WorkspaceProtocolRequest::RemoveMember { user_id, domain_id } => {
            use crate::handlers::domain::async_ops::AsyncUserManagementOperations;
            let domain_id = domain_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);

            match kernel
                .domain_ops()
                .remove_user_from_domain(actor_user_id, user_id, domain_id)
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

        WorkspaceProtocolRequest::ListMembers { domain_id } => {
            let target_id = domain_id.as_deref().unwrap_or(crate::WORKSPACE_ROOT_ID);

            // `domain_id` comes from the request and was trusted, with no check
            // that the caller belongs to it — so any authenticated account could
            // read the complete roster, roles and permission maps of every
            // office and room, including ones they were never added to.
            {
                use crate::handlers::domain::async_ops::{
                    AsyncDomainOperations, AsyncPermissionOperations,
                };
                let is_admin = kernel
                    .domain_ops()
                    .is_admin(actor_user_id)
                    .await
                    .unwrap_or(false);
                let is_member = kernel
                    .domain_ops()
                    .is_member_of_domain(actor_user_id, target_id)
                    .await
                    .unwrap_or(false);
                if !is_admin && !is_member {
                    return Ok(WorkspaceProtocolResponse::Error(
                        "Permission denied: not a member of this domain".to_string(),
                    ));
                }
            }

            // Collect member IDs from legacy Domain storage or DomainNode tree storage
            let member_ids = if let Ok(Some(domain)) = kernel
                .domain_operations
                .backend_tx_manager
                .get_domain(target_id)
                .await
            {
                domain.members().clone()
            } else if let Ok(Some(node)) = kernel
                .domain_operations
                .backend_tx_manager
                .get_node(target_id)
                .await
            {
                node.members.clone()
            } else {
                return Ok(WorkspaceProtocolResponse::Error(
                    "Domain not found".to_string(),
                ));
            };

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
                    // Report what enforcement would actually allow, not the raw
                    // map.
                    //
                    // `user.get_permissions(domain_id)` is an EXACT-domain
                    // lookup: empty for any domain the user was never
                    // explicitly added to. `check_entity_permission` — the path
                    // that decides whether an operation is permitted — is
                    // admin short-circuit, then direct grant, then inheritance
                    // up the parent chain, which is the model CLAUDE.md
                    // describes as "Workspace -> Office -> Room".
                    //
                    // The two disagreed, and the UI believes this one. The
                    // workspace creator is added to WORKSPACE_ROOT_ID as Admin
                    // at initialisation, so `check_entity_permission` grants
                    // them EditMdx on every office — while this endpoint
                    // answered "0 permissions" for the same office, and the
                    // Edit button stayed disabled forever. Measured: disabled
                    // at 2s, 10s, 20s, 40s and 60s after load, on a freshly
                    // created workspace.
                    //
                    // Computed THROUGH check_entity_permission rather than by
                    // reimplementing the walk here, so this answer cannot drift
                    // from enforcement or report access that would then be
                    // refused. It widens nothing: every permission listed is
                    // one the server would already have honoured.
                    let permissions: Vec<Permission> = {
                        use crate::handlers::domain::async_ops::AsyncPermissionOperations;
                        // Permission::ALL_VARIANTS is the single source of truth for
                        // which permissions exist; enumerating it here means a new
                        // variant is reported without touching this file.
                        let mut granted = Vec::new();
                        for permission in Permission::ALL_VARIANTS {
                            if kernel
                                .domain_ops()
                                .check_entity_permission(user_id, domain_id, permission)
                                .await
                                .unwrap_or(false)
                            {
                                granted.push(permission);
                            }
                        }
                        granted
                    };

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
                    .expect("system clock before unix epoch")
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
                        .expect("system clock before unix epoch")
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
                Ok(node) => {
                    // Everyone else has to learn the tree changed. Only
                    // NodeContentUpdated was ever broadcast, and the client calls
                    // listNodes exactly once, at login — so a room created here
                    // stayed invisible to every other user until they signed in
                    // again. The client handler for this variant already exists;
                    // it just never fired for anyone but the requester.
                    kernel.broadcast(
                        WorkspaceProtocolResponse::Node(node.clone()),
                        requester_cid,
                    );
                    Ok(WorkspaceProtocolResponse::Node(node))
                }
                Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
                    "Failed to create node: {}",
                    e
                ))),
            }
        }

        WorkspaceProtocolRequest::GetNode { node_id } => {
            use crate::handlers::domain::node_ops::AsyncNodeOperations;
            match kernel.domain_ops().get_node(actor_user_id, node_id).await {
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
            use std::time::{SystemTime, UNIX_EPOCH};
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
                Ok(node) => {
                    if let Some(content) = mdx_content {
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        let broadcast_response = WorkspaceProtocolResponse::NodeContentUpdated {
                            node_id: node_id.clone(),
                            mdx_content: content.clone(),
                            updated_by: actor_user_id.to_string(),
                            timestamp,
                        };

                        kernel.broadcast(broadcast_response, requester_cid);
                        info!(
                            target: "citadel",
                            "[ASYNC_PROCESS_COMMAND] Broadcast NodeContentUpdated for node {}",
                            node_id
                        );

                        // Full ancestor path, not the bare name: a room lives at
                        // {office}/{room}/CONTENT.md, and writing it to
                        // {room}/CONTENT.md put the edit where the loader reads
                        // OFFICES from — losing the edit and inventing an office.
                        let segments = kernel.content_path_segments(node_id).await;
                        if let Err(e) = kernel.persist_node_content_at(&segments, content).await {
                            warn!(
                                target: "citadel",
                                "[ASYNC_PROCESS_COMMAND] Failed to persist node content: {}",
                                e
                            );
                        }
                    }

                    // A rename (or any structural edit) is not a content update,
                    // so NodeContentUpdated above does not cover it — other
                    // users kept showing the old name until they signed in again.
                    if name.is_some()
                        || description.is_some()
                        || rules.is_some()
                        || chat_enabled.is_some()
                    {
                        kernel.broadcast(
                            WorkspaceProtocolResponse::Node(node.clone()),
                            requester_cid,
                        );
                    }

                    Ok(WorkspaceProtocolResponse::Node(node))
                }
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
                Ok(deleted_ids) => {
                    let response = WorkspaceProtocolResponse::NodeDeleted {
                        node_id: node_id.clone(),
                        children_deleted: deleted_ids
                            .into_iter()
                            .filter(|id| id != node_id)
                            .collect(),
                    };
                    // Without this, a deleted office stayed in every other
                    // user's sidebar and they kept opening and typing into it.
                    kernel.broadcast(response.clone(), requester_cid);
                    Ok(response)
                }
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
                    let response = WorkspaceProtocolResponse::NodeMoved {
                        node_id: node_id.clone(),
                        old_parent_id,
                        new_parent_id: node.parent_id,
                    };
                    kernel.broadcast(response.clone(), requester_cid);
                    Ok(response)
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
            let is_admin = kernel
                .domain_ops()
                .is_admin(actor_user_id)
                .await
                .unwrap_or(false);
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
            let is_admin = kernel
                .domain_ops()
                .is_admin(actor_user_id)
                .await
                .unwrap_or(false);
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
                if let Some(rule) = schema
                    .rules
                    .iter_mut()
                    .find(|r| &r.parent_type == parent_type)
                {
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
            // Get the schema to extract node types
            let schema = kernel
                .domain_operations
                .backend_tx_manager
                .get_tree_schema_or_default()
                .await?;

            // Derive node types from the schema (SSOT) instead of hardcoding
            let node_types = schema.to_builtin_node_types();

            Ok(WorkspaceProtocolResponse::NodeTypes(node_types))
        }
    }
}
