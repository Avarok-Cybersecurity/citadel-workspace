//! What a `FileShare` message does to the node's files (`kernel::chat_attachments`): sending one
//! records the share, and is refused unless the sender uploaded that file at this channel's node,
//! at the size the message says; deleting one forgets it, and the last share's delete deletes
//! the file. Both under `APPS_LOCK`, which the node's files are written under.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::apps_store::APPS_LOCK;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::GroupMessageType;

/// Said to a sender whose share names a file they did not upload here, or at another size.
pub const NOT_AN_UPLOAD_HERE: &str =
    "A shared file must be one you uploaded to this channel; the message was not sent";

/// Before message `message_id` is stored at `node_id`: records the share it makes, if any.
/// `Some` is the refusal to answer with, and nothing was recorded.
pub(super) async fn claim<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node_id: &str,
    sender: &str,
    message_type: &GroupMessageType,
    message_id: &str,
) -> Result<Option<&'static str>, NetworkError> {
    let GroupMessageType::FileShare {
        attachment_id,
        size_bytes,
        ..
    } = message_type
    else {
        return Ok(None);
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let mut files = backend.chat_attachment_index(node_id).await?;
    if !files.claim(attachment_id, *size_bytes, sender, message_id) {
        return Ok(Some(NOT_AN_UPLOAD_HERE));
    }
    backend.save_chat_attachment_index(node_id, &files).await?;
    Ok(None)
}

/// After message `message_id` was deleted at `node_id`: forgets the share it made, if any, and
/// deletes the file when no other message shares it.
pub(super) async fn release<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node_id: &str,
    message_type: &GroupMessageType,
    message_id: &str,
) -> Result<(), NetworkError> {
    let GroupMessageType::FileShare { attachment_id, .. } = message_type else {
        return Ok(());
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _guard = APPS_LOCK.lock().await;
    let mut files = backend.chat_attachment_index(node_id).await?;
    let Some(size_bytes) = files.release(attachment_id, message_id) else {
        return Ok(());
    };
    // The bytes first: stopped between the two, the index still names a file a read finds
    // missing (and refuses), never bytes nothing names.
    backend
        .drop_chat_attachments(node_id, &[(attachment_id.clone(), size_bytes)])
        .await?;
    backend.save_chat_attachment_index(node_id, &files).await
}
