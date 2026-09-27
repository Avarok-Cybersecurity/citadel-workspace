//! LiveDocOpen and LiveDocUpdate: live documents in office and room chats, relayed and stored by
//! the server (owner, 2026-09-27: "server-relayed for offices/rooms, mesh for groups").
//!
//! Reading a document needs read access to its channel, and changing one needs send access, as
//! reading and sending its messages do (`group_access`), so a guest who may read but not post
//! sees the document and cannot edit it. Accepted updates are numbered and reach every reader
//! of the channel; a reader that sees a number skipped re-opens the document.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::group_access::{
    authorize_group_read, authorize_group_write, GROUP_ACCESS_DENIED,
};
use crate::WorkspaceProtocolResponse;
use base64::Engine;
use citadel_sdk::prelude::{NetworkError, Ratchet};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// A document id is what the client minted (a UUID): nothing that could escape a storage key.
fn usable_doc_id(doc_id: &str) -> bool {
    (1..=64).contains(&doc_id.len())
        && doc_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn refuse(reason: impl Into<String>) -> Result<WorkspaceProtocolResponse, NetworkError> {
    Ok(WorkspaceProtocolResponse::Error(reason.into()))
}

pub(super) async fn open<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    group_id: &str,
    doc_id: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if authorize_group_read(kernel, actor_user_id, group_id)
        .await
        .is_none()
    {
        return refuse(GROUP_ACCESS_DENIED);
    }
    if !usable_doc_id(doc_id) {
        return refuse("that is not a live document id");
    }
    let (seq, state) = kernel
        .domain_operations
        .backend_tx_manager
        .live_doc_state(group_id, doc_id)
        .await?;
    Ok(WorkspaceProtocolResponse::LiveDocState {
        group_id: group_id.to_string(),
        doc_id: doc_id.to_string(),
        seq,
        state: B64.encode(state),
    })
}

pub(super) async fn update<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    group_id: &str,
    doc_id: &str,
    update: &str,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    if authorize_group_write(kernel, actor_user_id, group_id)
        .await
        .is_none()
    {
        return refuse(GROUP_ACCESS_DENIED);
    }
    if !usable_doc_id(doc_id) {
        return refuse("that is not a live document id");
    }
    let Ok(bytes) = B64.decode(update) else {
        return refuse("that is not a live document update");
    };
    let seq = match kernel
        .domain_operations
        .backend_tx_manager
        .apply_live_doc_update(group_id, doc_id, &bytes)
        .await?
    {
        Ok(seq) => seq,
        Err(refusal) => return refuse(refusal.to_string()),
    };
    let accepted = WorkspaceProtocolResponse::LiveDocUpdated {
        group_id: group_id.to_string(),
        doc_id: doc_id.to_string(),
        seq,
        update: update.to_string(),
    };
    // To the channel's readers only, as its messages go (BroadcastAudience::Group).
    kernel.broadcast_to_group(accepted.clone(), requester_cid, group_id.to_string());
    Ok(accepted)
}

/// The longest title a shared live document may carry.
pub const MAX_DOC_TITLE_CHARS: usize = 120;

/// The document fields of a group message: both present, and sane, exactly when it is a
/// LiveDocument message; absent otherwise.
pub(super) fn document_fields(
    message_type: &citadel_workspace_types::GroupMessageType,
    document_id: Option<&str>,
    document_title: Option<&str>,
) -> Result<(Option<String>, Option<String>), String> {
    let is_doc = *message_type == citadel_workspace_types::GroupMessageType::LiveDocument;
    match (is_doc, document_id, document_title) {
        (false, None, None) => Ok((None, None)),
        (true, Some(id), Some(title)) => {
            let title = title.trim();
            let chars = title.chars().count();
            if !usable_doc_id(id) {
                return Err("that is not a live document id".to_string());
            }
            if chars == 0 || chars > MAX_DOC_TITLE_CHARS || title.chars().any(char::is_control) {
                return Err(format!(
                    "a live document's title is 1 to {MAX_DOC_TITLE_CHARS} characters"
                ));
            }
            Ok((Some(id.to_string()), Some(title.to_string())))
        }
        _ => Err(
            "a live document message names its document and title; no other message does"
                .to_string(),
        ),
    }
}
