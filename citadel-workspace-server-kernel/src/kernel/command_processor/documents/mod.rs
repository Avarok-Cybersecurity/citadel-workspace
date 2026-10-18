//! The Documents sub-protocol: appending to a document node's update log, reading it, storing
//! the snapshot that compacts it, and relaying awareness.
//!
//! The permission is checked before the request is looked at, so a caller without it is refused
//! identically whatever they send: `EditMdx` to write, as saving a document's content needs,
//! and `ViewContent` to read or to be present, as reading it does. Pushes go through
//! `broadcast_to_node`, so they reach exactly the sessions a `Pull` would answer.
//!
//! Each write is persisted before it is acknowledged or announced, and announced under the log's
//! lock, so the broadcast order of a node's updates is their sequence order.

mod reads;
mod writes;

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::transaction::documents_store::StoredSnapshot;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::{
    required_permission, DocumentRefusal, DocumentsRequest, DocumentsResponse,
};
use reads::{pull, relay_awareness};
use writes::{append, store_snapshot, Written};

pub(super) type Answer = Result<WorkspaceProtocolResponse, NetworkError>;

pub(super) fn answer(response: DocumentsResponse) -> Answer {
    Ok(WorkspaceProtocolResponse::Documents(response))
}

pub(super) fn refused(refusal: DocumentRefusal) -> Answer {
    answer(DocumentsResponse::Refused(refusal))
}

/// `Err` carries the refusal when `len` is over `max`.
pub(super) fn within(len: usize, max: u64) -> Result<(), (u64, u64)> {
    let len = len as u64;
    if len > max {
        Err((len, max))
    } else {
        Ok(())
    }
}

pub(in crate::kernel::command_processor) async fn process<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    request: &DocumentsRequest,
) -> Answer {
    let Some(relay) = kernel.documents_relay() else {
        return refused(DocumentRefusal::NotConfigured);
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
    let config = &relay.config;
    match request {
        DocumentsRequest::Append {
            node_id,
            doc_version,
            update,
            client_seq,
        } => {
            let Some(author_cid) = requester_cid else {
                return refused(DocumentRefusal::NoSession);
            };
            if let Err((bytes, max_bytes)) = within(update.len(), config.max_update_bytes) {
                return refused(DocumentRefusal::UpdateTooLarge {
                    node_id: node_id.clone(),
                    size_bytes: bytes,
                    max_bytes,
                });
            }
            let written = Written {
                doc_version: *doc_version,
                update,
                author_cid,
                client_seq: *client_seq,
            };
            append(kernel, config, node_id, written).await
        }
        DocumentsRequest::Pull { node_id, since_seq } => {
            pull(kernel, config, node_id, *since_seq).await
        }
        DocumentsRequest::StoreSnapshot {
            node_id,
            doc_version,
            snapshot,
            upto_seq,
        } => {
            if let Err((bytes, max_bytes)) = within(snapshot.len(), config.max_snapshot_bytes) {
                return refused(DocumentRefusal::SnapshotTooLarge {
                    node_id: node_id.clone(),
                    size_bytes: bytes,
                    max_bytes,
                });
            }
            let stored = StoredSnapshot {
                doc_version: *doc_version,
                bytes: snapshot.clone(),
            };
            store_snapshot(kernel, node_id, stored, *upto_seq).await
        }
        DocumentsRequest::Awareness { node_id, payload } => {
            relay_awareness(kernel, relay, requester_cid, node_id, payload).await
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

pub(super) fn no_such_node(node_id: &str) -> Answer {
    refused(DocumentRefusal::NoSuchNode {
        node_id: node_id.to_string(),
    })
}
