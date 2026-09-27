//! Where a group channel's live documents are kept.
//!
//! One record per document (`citadel_workspace.live_docs.<group>.<doc>`: its merged state as
//! base64, and the number of the last update applied) and one index per channel (its document
//! ids), so a channel's documents can be counted and deleted with it. Apart from the node, which
//! is stored whole: a document edited many times a second must not rewrite its office.
//!
//! Every write takes the channel's group lock, the one its messages use, so two members typing
//! at once apply one after the other and each update gets its own number.

use super::BackendTransactionManager;
use crate::handlers::domain::live_doc_merge::{merge_update, MergeRefusal};
use base64::Engine;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use serde::{Deserialize, Serialize};

/// How many live documents one channel may hold.
pub const MAX_DOCS_PER_CHANNEL: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LiveDocRecord {
    seq: u32,
    /// The merged state, a v1 Yjs update, in base64 (JSON would triple a byte array).
    state: String,
}

fn doc_key(group_id: &str, doc_id: &str) -> String {
    format!("citadel_workspace.live_docs.{group_id}.{doc_id}")
}
fn index_key(group_id: &str) -> String {
    format!("citadel_workspace.live_docs.{group_id}")
}
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Why an update was not applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveDocRefusal {
    Merge(MergeRefusal),
    TooManyDocuments,
}

impl std::fmt::Display for LiveDocRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Merge(m) => m.fmt(f),
            Self::TooManyDocuments => {
                write!(
                    f,
                    "this chat already has {MAX_DOCS_PER_CHANNEL} live documents"
                )
            }
        }
    }
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// A document's merged state and last update number; an unknown document is empty at 0.
    pub async fn live_doc_state(
        &self,
        group_id: &str,
        doc_id: &str,
    ) -> Result<(u32, Vec<u8>), NetworkError> {
        match self
            .backend_get::<LiveDocRecord>(&doc_key(group_id, doc_id))
            .await?
        {
            Some(record) => Ok((
                record.seq,
                B64.decode(&record.state).map_err(|e| {
                    NetworkError::msg(format!("stored live document is not base64: {e}"))
                })?,
            )),
            None => Ok((0, Vec::new())),
        }
    }

    /// Merges `update` into the document and returns its new number, or why it was refused.
    pub async fn apply_live_doc_update(
        &self,
        group_id: &str,
        doc_id: &str,
        update: &[u8],
    ) -> Result<Result<u32, LiveDocRefusal>, NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let mut index: Vec<String> = self
            .backend_get(&index_key(group_id))
            .await?
            .unwrap_or_default();
        let known = index.iter().any(|d| d == doc_id);
        if !known && index.len() >= MAX_DOCS_PER_CHANNEL {
            return Ok(Err(LiveDocRefusal::TooManyDocuments));
        }
        let (seq, state) = self.live_doc_state(group_id, doc_id).await?;
        let merged = match merge_update(&state, update) {
            Ok(merged) => merged,
            Err(refusal) => return Ok(Err(LiveDocRefusal::Merge(refusal))),
        };
        let next = seq.saturating_add(1);
        self.backend_save(
            &doc_key(group_id, doc_id),
            &LiveDocRecord {
                seq: next,
                state: B64.encode(merged),
            },
        )
        .await?;
        if !known {
            index.push(doc_id.to_string());
            self.backend_save(&index_key(group_id), &index).await?;
        }
        Ok(Ok(next))
    }

    /// Drops every live document a channel held, with its index: called when its node goes.
    pub async fn delete_live_docs(&self, group_id: &str) -> Result<(), NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let index: Vec<String> = self
            .backend_get(&index_key(group_id))
            .await?
            .unwrap_or_default();
        for doc_id in &index {
            self.backend_delete(&doc_key(group_id, doc_id)).await?;
        }
        self.backend_delete(&index_key(group_id)).await
    }
}
