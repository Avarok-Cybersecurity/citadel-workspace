//! An append: refused unless its session is within its rate, its update within its size and
//! decodable, and every CRDT client it writes as is its author's; then numbered, stored and
//! announced. Past `compact_at_pending_bytes`, or refused `LogFull`, it starts the server's own
//! compaction (`compact`).

use super::compact::schedule;
use super::{answer, no_such_node, node_exists, refused, within, Answer};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::admission::{admit, AppendRefused};
use crate::kernel::documents::crdt::update_clocks;
use crate::kernel::documents::log::compaction_due;
use crate::kernel::documents::DocumentsRelay;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::documents::{
    CompactionRequested, DocumentRefusal, DocumentUpdate, DocumentsResponse,
};

/// An update as its writer sent it, before the log numbers it.
pub(super) struct Written<'a> {
    pub(super) doc_version: u32,
    pub(super) update: &'a [u8],
    pub(super) client_seq: u64,
}

pub(super) async fn append<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    relay: &DocumentsRelay,
    requester_cid: Option<u64>,
    node_id: &str,
    written: Written<'_>,
) -> Answer {
    let config = &relay.config;
    let Some(author_cid) = requester_cid else {
        return refused(DocumentRefusal::NoSession);
    };
    if !relay
        .append_limiter
        .try_consume(author_cid, crate::platform::Instant::now())
    {
        return refused(DocumentRefusal::AppendRateLimited {
            node_id: node_id.to_string(),
        });
    }
    if let Err((bytes, max_bytes)) = within(written.update.len(), config.max_update_bytes) {
        return refused(DocumentRefusal::UpdateTooLarge {
            node_id: node_id.to_string(),
            size_bytes: bytes,
            max_bytes,
        });
    }
    let writes = match update_clocks(written.update) {
        Ok(writes) => writes,
        Err(reason) => {
            return refused(DocumentRefusal::UpdateMalformed {
                node_id: node_id.to_string(),
                reason,
            })
        }
    };

    let backend = &kernel.domain_operations.backend_tx_manager;
    let _log = backend.lock_document(node_id).await;
    if !node_exists(kernel, node_id).await? {
        return no_such_node(node_id);
    }
    let current = backend.document_head(node_id).await?;
    let size = written.update.len() as u64;
    let head = match admit(&current, &writes, author_cid, size, config) {
        Ok(head) => head,
        Err(refusal) => {
            if let AppendRefused::LogFull { .. } = refusal {
                schedule(kernel, relay, node_id);
            }
            return refused(named(node_id, refusal));
        }
    };
    let entry = DocumentUpdate {
        seq: head.latest_seq,
        doc_version: written.doc_version,
        update: written.update.to_vec(),
        author_cid,
    };
    // The update before the head that counts it: a failure between the two leaves an update
    // nobody was told of, which the next append overwrites, never a head naming a missing one.
    backend.save_document_update(node_id, &entry).await?;
    backend.save_document_head(node_id, &head).await?;
    if head.pending_bytes >= config.compact_at_pending_bytes {
        schedule(kernel, relay, node_id);
    }

    kernel.broadcast_to_node(
        WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentUpdated {
            node_id: node_id.to_string(),
            seq: entry.seq,
            doc_version: entry.doc_version,
            update: entry.update,
            author_cid,
        }),
        Some(author_cid),
        node_id.to_string(),
    );
    answer(DocumentsResponse::Appended {
        node_id: node_id.to_string(),
        seq: head.latest_seq,
        client_seq: written.client_seq,
        compaction: compaction_due(&head, config.snapshot_min_updates).map(|pending| {
            CompactionRequested {
                node_id: node_id.to_string(),
                pending,
            }
        }),
    })
}

fn named(node_id: &str, refusal: AppendRefused) -> DocumentRefusal {
    let node_id = node_id.to_string();
    match refusal {
        AppendRefused::Reserved => DocumentRefusal::ClientIdReserved { node_id },
        AppendRefused::Foreign { crdt_client } => DocumentRefusal::ClientIdForeign {
            node_id,
            crdt_client,
        },
        AppendRefused::TooManyClients { max_clients } => DocumentRefusal::TooManyClients {
            node_id,
            max_clients,
        },
        AppendRefused::LogFull {
            pending_bytes,
            max_bytes,
        } => DocumentRefusal::LogFull {
            node_id,
            pending_bytes,
            max_bytes,
        },
    }
}
