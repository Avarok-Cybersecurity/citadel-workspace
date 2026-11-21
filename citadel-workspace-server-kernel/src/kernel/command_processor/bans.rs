//! `Ban` and `Unban`: changing a member's standing, announced to the workspace so every roster
//! and the member's own client hear it. `ListBanned`: who holds that standing.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::{WorkspaceProtocolResponse, WORKSPACE_ROOT_ID};
use citadel_sdk::prelude::{NetworkError, Ratchet};

pub(super) async fn ban<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if let Err(e) = kernel
        .domain_operations
        .ban_member(actor_user_id, user_id)
        .await
    {
        return Ok(WorkspaceProtocolResponse::Error(format!(
            "Failed to ban member: {e}"
        )));
    }
    let notice = WorkspaceProtocolResponse::MemberBanned {
        user_id: user_id.to_string(),
    };
    kernel.broadcast_to_workspace(notice.clone(), requester_cid, WORKSPACE_ROOT_ID.to_string());
    Ok(notice)
}

pub(super) async fn list_banned<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(
        match kernel.domain_operations.list_banned(actor_user_id).await {
            Ok(members) => WorkspaceProtocolResponse::BannedMembers { members },
            Err(e) => WorkspaceProtocolResponse::Error(format!("Failed to list banned members: {e}")),
        },
    )
}

pub(super) async fn unban<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    user_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let role_id = match kernel
        .domain_operations
        .unban_member(actor_user_id, user_id)
        .await
    {
        Ok(role_id) => role_id,
        Err(e) => {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Failed to unban member: {e}"
            )))
        }
    };
    let notice = WorkspaceProtocolResponse::MemberUnbanned {
        user_id: user_id.to_string(),
        role_id,
    };
    kernel.broadcast_to_workspace(notice.clone(), requester_cid, WORKSPACE_ROOT_ID.to_string());
    Ok(notice)
}
