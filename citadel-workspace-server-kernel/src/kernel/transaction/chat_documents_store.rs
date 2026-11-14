//! The list of a node's chat documents, so deleting the node deletes their logs.
//!
//! The backend has no listing by key prefix, so a log nobody names would outlive its node. Each
//! chat document is listed under its node's lock before its first update is stored, which is the
//! only way a log comes to exist; the node delete reads the list under the same lock.
//!
//! In pages, as a room's messages are (`group_message_pages`): listing a document writes one
//! page and the count, never the whole list, so a node with many documents does not make each
//! new one cost all the others.
//!
//! The workspace's plan limits how many chat documents every node together holds
//! (`kernel::chat_document_limit`), so one workspace counter is kept beside the lists, read and
//! written under `CHAT_DOCUMENTS_COUNT_LOCK` (taken after a node's lock, never before): a new
//! document is one counter read, not a walk of every node's list. It is raised before a document
//! is listed and lowered after a page of them is dropped, so a write that fails part way leaves
//! the count high, which refuses early, and never low, which would let the limit be passed.

use super::BackendTransactionManager;
use crate::kernel::chat_document_limit::{full_at, ChatDocumentLimitUnavailable, Limit};
use crate::kernel::documents::address::{chat_namespace, DocAddress};
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// Held while the workspace's chat-document count is read and written.
pub(crate) static CHAT_DOCUMENTS_COUNT_LOCK: tokio::sync::Mutex<()> =
    tokio::sync::Mutex::const_new(());

/// The one key of the workspace's chat-document count.
const WORKSPACE_COUNT_KEY: &str = "citadel_workspace.chat_documents_count";

/// What listing a document came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Listing {
    /// It is listed now, new, and counted.
    Listed,
    /// An earlier first append listed (and counted) it, then stopped before storing its update.
    AlreadyListed,
    /// The workspace holds `limit` already; nothing was written.
    LimitReached { limit: u32 },
    /// The host could not say what the limit is; nothing was written.
    LimitUnknown(ChatDocumentLimitUnavailable),
}

/// How many document ids share a page of the list.
const LIST_PAGE_LEN: u64 = 256;

fn count_key(node_id: &str) -> String {
    format!("{}.index", chat_namespace(node_id))
}

fn page_key(node_id: &str, page: u64) -> String {
    format!("{}.index.{page}", chat_namespace(node_id))
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Lists `doc` among its node's chat documents, counted toward the workspace's limit, which
    /// `limit` asks the host for only when the document is new. The caller holds the node's lock
    /// and has not yet stored the document's first update.
    pub(crate) async fn list_chat_document(
        &self,
        doc: &DocAddress,
        limit: impl FnOnce() -> Result<Limit, ChatDocumentLimitUnavailable>,
    ) -> Result<Listing, NetworkError> {
        let Some(chat_doc) = &doc.chat_doc else {
            return Err(NetworkError::msg(
                "a node's page is not one of its chat documents",
            ));
        };
        let count: u64 = self
            .backend_get(&count_key(&doc.node_id))
            .await?
            .unwrap_or(0);
        let page = count / LIST_PAGE_LEN;
        let mut ids: Vec<String> = self
            .backend_get(&page_key(&doc.node_id, page))
            .await?
            .unwrap_or_default();
        if ids.contains(chat_doc) {
            return Ok(Listing::AlreadyListed);
        }
        let limit = match limit() {
            Ok(limit) => limit,
            Err(unknown) => return Ok(Listing::LimitUnknown(unknown)),
        };
        {
            let _count = CHAT_DOCUMENTS_COUNT_LOCK.lock().await;
            let held = self.chat_documents_held().await?;
            if let Some(full) = full_at(limit, held) {
                return Ok(Listing::LimitReached { limit: full });
            }
            self.backend_save(WORKSPACE_COUNT_KEY, &(held + 1)).await?;
        }
        ids.push(chat_doc.clone());
        // The page before the count: stopped between the two, the id is on the page the count
        // still points at, where the delete reads.
        self.backend_save(&page_key(&doc.node_id, page), &ids)
            .await?;
        self.backend_save(&count_key(&doc.node_id), &(count + 1))
            .await?;
        Ok(Listing::Listed)
    }

    /// How many chat documents the workspace holds, every node's.
    pub(crate) async fn chat_documents_held(&self) -> Result<u64, NetworkError> {
        Ok(self.backend_get(WORKSPACE_COUNT_KEY).await?.unwrap_or(0))
    }

    /// Drops every chat document of `node_id`, and the list. The caller holds the node's lock.
    /// Each page's logs go before the page, and the count last, so a delete that fails part way
    /// still lists what it has not dropped.
    pub(super) async fn delete_chat_documents(&self, node_id: &str) -> Result<(), NetworkError> {
        let Some(count) = self.backend_get::<u64>(&count_key(node_id)).await? else {
            return Ok(());
        };
        for page in 0..=count / LIST_PAGE_LEN {
            let key = page_key(node_id, page);
            let ids: Vec<String> = self.backend_get(&key).await?.unwrap_or_default();
            for chat_doc in &ids {
                self.drop_document_log(&DocAddress::chat(node_id, chat_doc))
                    .await?;
            }
            self.backend_delete(&key).await?;
            let _count = CHAT_DOCUMENTS_COUNT_LOCK.lock().await;
            let held = self.chat_documents_held().await?;
            self.backend_save(WORKSPACE_COUNT_KEY, &held.saturating_sub(ids.len() as u64))
                .await?;
        }
        self.backend_delete(&count_key(node_id)).await
    }
}
