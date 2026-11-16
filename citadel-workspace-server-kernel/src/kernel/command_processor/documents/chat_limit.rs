//! A chat document's first update makes it a new document, which counts toward the workspace's
//! plan limit (`kernel::chat_document_limit`): listed and counted under the node's lock, or
//! refused inside the document's envelope with the limit it reached.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::chat_document_limit::{ChatDocumentLimitUnavailable, Limit};
use crate::kernel::documents::address::DocAddress;
use crate::kernel::transaction::chat_documents_store::Listing;
use citadel_logging::warn;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::documents::DocumentRefusal;

/// Lists `doc` (a chat document whose log is empty), or the refusal that stops it. The caller
/// holds the node's lock.
pub(super) async fn list_new<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    doc: &DocAddress,
) -> Result<Option<DocumentRefusal>, NetworkError> {
    let limit = || -> Result<Limit, ChatDocumentLimitUnavailable> {
        match kernel.chat_document_limit_source() {
            Some(source) => source.limit(),
            None => Err(ChatDocumentLimitUnavailable(
                "this server was given no chat-document limit".to_string(),
            )),
        }
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let node_id = doc.node_id.clone();
    Ok(match backend.list_chat_document(doc, limit).await? {
        Listing::Listed | Listing::AlreadyListed => None,
        Listing::LimitReached { limit } => {
            Some(DocumentRefusal::ChatDocumentLimitReached { node_id, limit })
        }
        Listing::LimitUnknown(ChatDocumentLimitUnavailable(why)) => {
            warn!(target: "citadel", "No chat-document limit for {node_id}: {why}");
            Some(DocumentRefusal::ChatDocumentLimitUnavailable { node_id })
        }
    })
}
