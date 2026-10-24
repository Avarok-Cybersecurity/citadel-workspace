//! `GroupTyping`: a member is typing in a node channel.
//!
//! Relayed to the channel's readers and never stored, the shape of a document's awareness
//! record. Bounded per session and channel, because a client that does not debounce would
//! otherwise fan every keystroke out to the whole channel.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::group_access::{authorize_group_write, GROUP_ACCESS_DENIED};
use crate::kernel::group_chat_gates::TYPING_INTERVAL;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::WorkspaceProtocolResponse;

/// Said to a client that reports typing faster than the server relays it.
pub const TYPING_TOO_SOON: &str =
    "Typing is relayed at most once every three seconds; this notice was not sent";

pub async fn typing<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    group_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    // Saying you are about to write is part of writing: a reader who cannot send is not typing.
    if authorize_group_write(kernel, actor_user_id, group_id)
        .await
        .is_none()
    {
        return Ok(WorkspaceProtocolResponse::Error(
            GROUP_ACCESS_DENIED.to_string(),
        ));
    }
    let session = requester_cid.map_or_else(|| actor_user_id.to_string(), |cid| cid.to_string());
    let key = format!("{group_id}\u{0}{session}");
    if !kernel.group_chat_gates.typing.try_pass(
        key,
        crate::platform::Instant::now(),
        TYPING_INTERVAL,
    ) {
        return Ok(WorkspaceProtocolResponse::Error(
            TYPING_TOO_SOON.to_string(),
        ));
    }
    let notification = WorkspaceProtocolResponse::GroupTypingNotice {
        group_id: group_id.to_string(),
        member: actor_user_id.to_string(),
    };
    kernel.broadcast_to_group(notification.clone(), requester_cid, group_id.to_string());
    Ok(notification)
}
