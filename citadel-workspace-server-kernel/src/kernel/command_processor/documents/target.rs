//! Which document a request is about, how its answers are addressed, and who hears its pushes.
//!
//! A page's answers go out as `Documents` and its pushes to the node's viewers; a chat
//! document's go out as `ChatDocuments`, carrying its id, and its pushes to the channel's readers
//! (`broadcast_to_group`), the same people `GetGroupMessages` answers. One place decides both,
//! so a push cannot reach someone the matching pull refuses.

use super::Answer;
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::documents::address::DocAddress;
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::chat_documents::ChatDocumentsResponse;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsResponse};

#[derive(Debug, Clone)]
pub(super) enum Target {
    Page(DocAddress),
    /// `channel` is the node's `chat_channel_id` when the gate admitted the request.
    Chat {
        doc: DocAddress,
        chat_doc: String,
        channel: String,
    },
}

impl Target {
    pub(super) fn page(node_id: &str) -> Self {
        Self::Page(DocAddress::page(node_id))
    }

    pub(super) fn chat(node_id: &str, chat_doc: &str, channel: String) -> Self {
        Self::Chat {
            doc: DocAddress::chat(node_id, chat_doc),
            chat_doc: chat_doc.to_string(),
            channel,
        }
    }

    pub(super) fn doc(&self) -> &DocAddress {
        match self {
            Self::Page(doc) | Self::Chat { doc, .. } => doc,
        }
    }

    pub(super) fn node_id(&self) -> &str {
        &self.doc().node_id
    }

    pub(super) fn addressed(&self, answer: DocumentsResponse) -> WorkspaceProtocolResponse {
        addressed(self.chat_doc(), answer)
    }

    fn chat_doc(&self) -> Option<&str> {
        match self {
            Self::Page(_) => None,
            Self::Chat { chat_doc, .. } => Some(chat_doc),
        }
    }

    pub(super) fn answer(&self, answer: DocumentsResponse) -> Answer {
        Ok(self.addressed(answer))
    }

    pub(super) fn refused(&self, refusal: DocumentRefusal) -> Answer {
        self.answer(DocumentsResponse::Refused(refusal))
    }

    pub(super) fn no_such_node(&self) -> Answer {
        self.refused(DocumentRefusal::NoSuchNode {
            node_id: self.node_id().to_string(),
        })
    }

    /// Pushes `push` to everyone who may read this document, but `exclude`.
    pub(super) fn announce<R: Ratchet + Send + Sync + 'static>(
        &self,
        kernel: &AsyncWorkspaceServerKernel<R>,
        push: DocumentsResponse,
        exclude: Option<u64>,
    ) {
        let response = self.addressed(push);
        match self {
            Self::Page(doc) => kernel.broadcast_to_node(response, exclude, doc.node_id.clone()),
            Self::Chat { channel, .. } => {
                kernel.broadcast_to_group(response, exclude, channel.clone())
            }
        }
    }
}

/// `answer` as a page's (`chat_doc` `None`) or as the chat document `chat_doc`'s.
pub(super) fn addressed(
    chat_doc: Option<&str>,
    answer: DocumentsResponse,
) -> WorkspaceProtocolResponse {
    match chat_doc {
        None => WorkspaceProtocolResponse::Documents(answer),
        Some(chat_doc) => WorkspaceProtocolResponse::ChatDocuments(ChatDocumentsResponse {
            chat_doc: chat_doc.to_string(),
            answer,
        }),
    }
}
