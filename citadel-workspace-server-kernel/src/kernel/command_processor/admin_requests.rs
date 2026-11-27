//! A member's ask of the admins (`citadel_workspace_types::admin_requests`): stamped with who
//! asked and when, kept in each admin's user record until one of their clients has written it
//! to its Scratchpad and acknowledged it, and announced to the admins' live sessions.
//!
//! The admins are the members who may edit the workspace's configuration, the asker excepted:
//! asking yourself is refused `NoAdmins`, and the asker's client then offers the action itself.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::admin_requests::{
    checked_ask, may_ask_again, with_entry, without_ids, AdminAskRefusal, AdminRequestEntry,
    AdminRequestsRequest, AdminRequestsResponse, ADMIN_ASK_LAST_KEY, ADMIN_REQUESTS_KEY,
};
use citadel_workspace_types::structs::{MetadataValue, Permission, User};

fn answer(response: AdminRequestsResponse) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(WorkspaceProtocolResponse::AdminRequests(response))
}

fn pending_of(user: &User) -> Vec<AdminRequestEntry> {
    match user.metadata.get(ADMIN_REQUESTS_KEY) {
        Some(MetadataValue::String(json)) => serde_json::from_str(json).unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn set_pending(user: &mut User, pending: &[AdminRequestEntry]) -> Result<(), NetworkError> {
    if pending.is_empty() {
        user.metadata.remove(ADMIN_REQUESTS_KEY);
        return Ok(());
    }
    let json = serde_json::to_string(pending)
        .map_err(|e| NetworkError::msg(format!("Failed to encode the admin asks: {e}")))?;
    user.metadata
        .insert(ADMIN_REQUESTS_KEY.to_string(), MetadataValue::String(json));
    Ok(())
}

fn last_ask_of(user: &User) -> Option<u64> {
    match user.metadata.get(ADMIN_ASK_LAST_KEY) {
        Some(MetadataValue::Number(ms)) if *ms >= 0.0 => Some(*ms as u64),
        _ => None,
    }
}

pub(super) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    request: &AdminRequestsRequest,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    match request {
        AdminRequestsRequest::Ask { text } => ask(kernel, actor_user_id, text).await,
        AdminRequestsRequest::Take => take(kernel, actor_user_id).await,
        AdminRequestsRequest::Ack { ids } => ack(kernel, actor_user_id, ids).await,
    }
}

async fn admins_of<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> Result<Vec<String>, NetworkError> {
    let workspace = kernel
        .domain_operations
        .backend_tx_manager
        .get_workspace(WORKSPACE_ROOT_ID)
        .await?
        .ok_or_else(|| NetworkError::msg("The root workspace does not exist"))?;
    let mut admins = Vec::new();
    for member in workspace
        .members
        .iter()
        .filter(|m| m.as_str() != actor_user_id)
    {
        let can = kernel
            .domain_operations
            .check_entity_permission(member, WORKSPACE_ROOT_ID, Permission::EditWorkspaceConfig)
            .await
            .unwrap_or(false);
        if can {
            admins.push(member.clone());
        }
    }
    Ok(admins)
}

async fn ask<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    text: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let text = match checked_ask(text) {
        Ok(text) => text,
        Err(refusal) => return answer(AdminRequestsResponse::Refused(refusal)),
    };
    let admins = admins_of(kernel, actor_user_id).await?;
    if admins.is_empty() {
        return answer(AdminRequestsResponse::Refused(AdminAskRefusal::NoAdmins));
    }
    let now_ms = super::telemetry::now_ms()?;
    let backend = &kernel.domain_operations.backend_tx_manager;
    {
        // The same lock every user-record writer takes, held across each read and write.
        let _workspace_guard = backend.lock_workspaces().await;
        let Some(mut asker) = backend.get_user(actor_user_id).await? else {
            return Ok(WorkspaceProtocolResponse::Error(
                "User not found".to_string(),
            ));
        };
        if !may_ask_again(last_ask_of(&asker), now_ms) {
            return answer(AdminRequestsResponse::Refused(AdminAskRefusal::TooSoon));
        }
        asker.metadata.insert(
            ADMIN_ASK_LAST_KEY.to_string(),
            MetadataValue::Number(now_ms as f64),
        );
        backend
            .insert_user(actor_user_id.to_string(), asker)
            .await?;
        let entry = AdminRequestEntry {
            id: format!("{now_ms:x}.{actor_user_id}"),
            from_user: actor_user_id.to_string(),
            at_ms: now_ms,
            text,
        };
        for admin in &admins {
            let Some(mut user) = backend.get_user(admin).await? else {
                continue;
            };
            let pending = with_entry(pending_of(&user), entry.clone());
            set_pending(&mut user, &pending)?;
            backend.insert_user(admin.clone(), user).await?;
        }
    }
    for admin in &admins {
        kernel.broadcast_to_user(
            WorkspaceProtocolResponse::AdminRequests(AdminRequestsResponse::Waiting),
            admin.clone(),
        );
    }
    answer(AdminRequestsResponse::Asked {
        admins: u32::try_from(admins.len()).unwrap_or(u32::MAX),
    })
}

async fn take<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let entries = match backend.get_user(actor_user_id).await? {
        Some(user) => pending_of(&user),
        None => Vec::new(),
    };
    answer(AdminRequestsResponse::Pending { entries })
}

async fn ack<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    ids: &[String],
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _workspace_guard = backend.lock_workspaces().await;
    let Some(mut user) = backend.get_user(actor_user_id).await? else {
        return answer(AdminRequestsResponse::Acked { removed: 0 });
    };
    let (kept, removed) = without_ids(pending_of(&user), ids);
    if removed > 0 {
        set_pending(&mut user, &kept)?;
        backend.insert_user(actor_user_id.to_string(), user).await?;
    }
    answer(AdminRequestsResponse::Acked { removed })
}
