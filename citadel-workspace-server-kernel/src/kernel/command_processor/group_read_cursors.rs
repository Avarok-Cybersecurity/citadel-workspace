//! `MarkGroupRead`: a member says how far they have read a node channel.
//!
//! The node chat's read receipts never worked: `read_by` existed only in the UI, nothing on the
//! wire carried it, and the footer always showed one grey "Sent". The server now keeps one cursor
//! per (channel, member), returns them with the history, and broadcasts each move, so ticks are
//! derived from what members actually reported.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::group_access::{authorize_group, GROUP_ACCESS_DENIED};
use crate::kernel::group_chat_gates::READ_CURSOR_INTERVAL;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::group_chat::GroupReadCursor;
use citadel_workspace_types::structs::Permission;
use citadel_workspace_types::WorkspaceProtocolResponse;

/// Said to a client that writes cursors faster than the server keeps them.
pub const READ_CURSOR_TOO_SOON: &str =
    "Read receipts are kept at most once a second; this one was not recorded";

pub async fn mark_read<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    group_id: &str,
    upto_message_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if authorize_group(kernel, actor_user_id, group_id, Permission::ReadMessages)
        .await
        .is_none()
    {
        return Ok(WorkspaceProtocolResponse::Error(
            GROUP_ACCESS_DENIED.to_string(),
        ));
    }
    let backend = &kernel.domain_operations.backend_tx_manager;
    // A cursor names a message of this channel, or it would claim a read of nothing.
    match backend.get_group_message(group_id, upto_message_id).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return Ok(WorkspaceProtocolResponse::Error(
                "Message not found".to_string(),
            ))
        }
        Err(e) => {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Failed to get message: {e}"
            )))
        }
    }
    let key = format!("{group_id}\u{0}{actor_user_id}");
    let now = crate::platform::Instant::now();
    if !kernel
        .group_chat_gates
        .read_cursors
        .try_pass(key, now, READ_CURSOR_INTERVAL)
    {
        return Ok(WorkspaceProtocolResponse::Error(
            READ_CURSOR_TOO_SOON.to_string(),
        ));
    }
    if let Err(e) = backend
        .set_group_read_cursor(group_id, actor_user_id, upto_message_id)
        .await
    {
        return Ok(WorkspaceProtocolResponse::Error(format!(
            "Failed to record the read receipt: {e}"
        )));
    }
    let notification = WorkspaceProtocolResponse::GroupReadCursorMoved {
        group_id: group_id.to_string(),
        cursor: GroupReadCursor {
            member: actor_user_id.to_string(),
            upto_message_id: upto_message_id.to_string(),
        },
    };
    kernel.broadcast_to_group(notification.clone(), requester_cid, group_id.to_string());
    Ok(notification)
}
