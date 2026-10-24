//! `ReactGroupMessage`: a member adds or retracts a reaction on a node channel's message.
//!
//! The node chat had no reactions because the workspace server had no request for them; the UI
//! hid the control there. Reactions are stored on the message, so they survive a reload and
//! reach a reader who opens the channel later, and every change is broadcast to the channel.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::group_access::{authorize_group_write, GROUP_ACCESS_DENIED};
use crate::kernel::transaction::ReactionWrite;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::group_chat::{apply_reaction, ReactionChange};
use citadel_workspace_types::WorkspaceProtocolResponse;

pub(crate) fn now_ms() -> u64 {
    crate::platform::SystemTime::now()
        .duration_since(crate::platform::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_millis() as u64
}

#[allow(clippy::too_many_arguments)]
pub async fn react<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    group_id: &str,
    message_id: &str,
    emoji: &str,
    on: bool,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    // Reacting is writing to the channel: the same permission as sending into it.
    if authorize_group_write(kernel, actor_user_id, group_id)
        .await
        .is_none()
    {
        return Ok(WorkspaceProtocolResponse::Error(
            GROUP_ACCESS_DENIED.to_string(),
        ));
    }
    // Who reacted is the session the request arrived on, never a field of the request.
    let Some(reactor_cid) = requester_cid else {
        return Ok(WorkspaceProtocolResponse::Error(
            "A reaction has to come from a session the server can attribute".to_string(),
        ));
    };
    let change = ReactionChange {
        emoji,
        reactor_cid,
        on,
        at: now_ms(),
    };
    let written = kernel
        .domain_operations
        .backend_tx_manager
        .change_group_message_reactions(group_id, message_id, |current| {
            apply_reaction(current, &change)
        })
        .await;
    match written {
        Ok(ReactionWrite::Applied(reactions)) => {
            let notification = WorkspaceProtocolResponse::GroupMessageReacted {
                group_id: group_id.to_string(),
                message_id: message_id.to_string(),
                reactions,
            };
            kernel.broadcast_to_group(notification.clone(), requester_cid, group_id.to_string());
            Ok(notification)
        }
        Ok(ReactionWrite::NoSuchMessage) => Ok(WorkspaceProtocolResponse::Error(
            "Message not found".to_string(),
        )),
        Ok(ReactionWrite::Refused(reason)) => Ok(WorkspaceProtocolResponse::Error(reason)),
        Err(e) => Ok(WorkspaceProtocolResponse::Error(format!(
            "Failed to update the reaction: {e}"
        ))),
    }
}
