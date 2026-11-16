//! The Documents sub-protocol: appending to a document node's update log, reading it, storing
//! the snapshot that compacts it, and relaying awareness.
//!
//! The permission is checked before the request is looked at, so a caller without it is refused
//! identically whatever they send: `EditMdx` to write, as saving a document's content needs,
//! and `ViewContent` to read or to be present, as reading it does. Pushes go through
//! `broadcast_to_node`, so they reach exactly the sessions a `Pull` would answer.
//!
//! A document shared in a node's chat takes the same paths, addressed by `Target`: its own log,
//! the channel's gates instead of the page's (`chat_gate`), and the channel's readers for its
//! pushes.
//!
//! Each write is persisted before it is acknowledged or announced, and announced under the log's
//! lock, so the broadcast order of a node's updates is their sequence order. Every request is
//! attributed to its session, which the per-session rates count against; the cheap refusals
//! (session, rate, size) come before the CRDT bytes are decoded, and decoding before the log is
//! locked.

mod append;
mod chat_gate;
mod chat_limit;
mod commit;
mod compact;
mod reads;
mod snapshot;
mod target;

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::DocumentsRelay;
use crate::WorkspaceProtocolResponse;
use append::{append, Written};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::chat_documents::ChatDocumentsRequest;
use citadel_workspace_types::documents::{
    required_permission, DocumentRefusal, DocumentsRequest, DocumentsResponse,
};
use reads::{pull, relay_awareness};
use snapshot::{store_snapshot, Offered};
use target::{addressed, Target};

pub(super) type Answer = Result<WorkspaceProtocolResponse, NetworkError>;

/// `Err` carries the refusal when `len` is over `max`.
pub(super) fn within(len: usize, max: u64) -> Result<(), (u64, u64)> {
    let len = len as u64;
    if len > max {
        Err((len, max))
    } else {
        Ok(())
    }
}

/// A request about a node's page.
pub(in crate::kernel::command_processor) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &DocumentsRequest,
) -> Answer {
    let Some(relay) = kernel.documents_relay() else {
        return not_configured(None);
    };
    let permission = required_permission(request);
    if !kernel
        .domain_operations
        .check_entity_permission(actor_user_id, request.node_id(), permission)
        .await?
    {
        return Ok(WorkspaceProtocolResponse::Error(format!(
            "Permission denied: {permission:?} required"
        )));
    }
    let target = Target::page(request.node_id());
    run(kernel, relay, requester_cid, &target, request).await
}

/// A request about a document shared in a node's chat.
pub(in crate::kernel::command_processor) async fn process_chat<
    R: Ratchet + Send + Sync + 'static,
>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    chat: &ChatDocumentsRequest,
) -> Answer {
    let Some(relay) = kernel.documents_relay() else {
        return not_configured(Some(&chat.chat_doc));
    };
    match chat_gate::admit(kernel, actor_user_id, &chat.chat_doc, &chat.request).await? {
        Ok(target) => run(kernel, relay, requester_cid, &target, &chat.request).await,
        Err(refusal) => Ok(addressed(
            Some(&chat.chat_doc),
            DocumentsResponse::Refused(refusal),
        )),
    }
}

fn not_configured(chat_doc: Option<&str>) -> Answer {
    Ok(addressed(
        chat_doc,
        DocumentsResponse::Refused(DocumentRefusal::NotConfigured),
    ))
}

async fn run<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    target: &Target,
    request: &DocumentsRequest,
) -> Answer {
    match request {
        DocumentsRequest::Append {
            doc_version,
            update,
            client_seq,
            ..
        } => {
            let written = Written {
                doc_version: *doc_version,
                update,
                client_seq: *client_seq,
            };
            append(kernel, relay, requester_cid, target, written).await
        }
        DocumentsRequest::Pull { since_seq, .. } => {
            pull(kernel, relay, requester_cid, target, *since_seq).await
        }
        DocumentsRequest::StoreSnapshot {
            doc_version,
            snapshot,
            upto_seq,
            ..
        } => {
            let offered = Offered {
                doc_version: *doc_version,
                snapshot,
                upto_seq: *upto_seq,
            };
            store_snapshot(kernel, relay, requester_cid, target, offered).await
        }
        DocumentsRequest::Awareness { payload, .. } => {
            relay_awareness(kernel, relay, requester_cid, target, payload).await
        }
    }
}

/// Whether the node is still in the tree. Asked under the log's lock: see `documents_store`.
pub(super) async fn node_exists<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    node_id: &str,
) -> Result<bool, NetworkError> {
    let nodes = kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes_shared()
        .await?;
    Ok(nodes.contains_key(node_id))
}
