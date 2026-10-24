//! The list of a node's chat documents, so deleting the node deletes their logs.
//!
//! The backend has no listing by key prefix, so a log nobody names would outlive its node. Each
//! chat document is listed under its node's lock before its first update is stored, which is the
//! only way a log comes to exist; the node delete reads the list under the same lock.
//!
//! In pages, as a room's messages are (`group_message_pages`): listing a document writes one
//! page and the count, never the whole list, so a node with many documents does not make each
//! new one cost all the others.

use super::BackendTransactionManager;
use crate::kernel::documents::address::{chat_namespace, DocAddress};
use citadel_sdk::prelude::{NetworkError, Ratchet};

/// How many document ids share a page of the list.
const LIST_PAGE_LEN: u64 = 256;

fn count_key(node_id: &str) -> String {
    format!("{}.index", chat_namespace(node_id))
}

fn page_key(node_id: &str, page: u64) -> String {
    format!("{}.index.{page}", chat_namespace(node_id))
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Lists `doc` among its node's chat documents. The caller holds the node's lock and has not
    /// yet stored the document's first update.
    pub(crate) async fn list_chat_document(&self, doc: &DocAddress) -> Result<(), NetworkError> {
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
        // Listed by an earlier first append that stopped before storing its update.
        if ids.contains(chat_doc) {
            return Ok(());
        }
        ids.push(chat_doc.clone());
        // The page before the count: stopped between the two, the id is on the page the count
        // still points at, where the delete reads.
        self.backend_save(&page_key(&doc.node_id, page), &ids)
            .await?;
        self.backend_save(&count_key(&doc.node_id), &(count + 1))
            .await
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
        }
        self.backend_delete(&count_key(node_id)).await
    }
}
