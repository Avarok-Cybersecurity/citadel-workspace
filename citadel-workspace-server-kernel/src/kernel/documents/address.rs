//! Which document a log is: a node's page, or a document shared in the node's chat. Pure: the
//! storage keys and the compaction guard's identity are decided here, once, for both.
//!
//! Every document of a node, page or chat, shares the node's lock stripe
//! (`documents_store::lock_document`), so the node delete, which holds its nodes' locks across the
//! purge, holds every chat document's lock too.

/// A document's log, by the node it belongs to and, for a chat document, its id.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct DocAddress {
    pub node_id: String,
    /// `None` is the node's page. `Some` is checked by `chat_documents::is_chat_document_id`
    /// before an address is made from it, so it holds no `.`.
    pub chat_doc: Option<String>,
}

impl DocAddress {
    pub fn page(node_id: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            chat_doc: None,
        }
    }

    pub fn chat(node_id: &str, chat_doc: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            chat_doc: Some(chat_doc.to_string()),
        }
    }

    /// What every key of the log starts with. A page's keys are the ones stored before chat
    /// documents existed. A chat document's live under their own namespace, and end with the
    /// document's id, which holds no `.`, so no node id can make one document's key another's.
    pub fn key_prefix(&self) -> String {
        match &self.chat_doc {
            None => format!("citadel_workspace.documents.{}", self.node_id),
            Some(doc) => chat_document_key(&self.node_id, doc),
        }
    }
}

fn chat_document_key(node_id: &str, chat_doc: &str) -> String {
    format!("{}.{chat_doc}", chat_namespace(node_id))
}

/// Where a node's chat documents, and the list of them, are kept.
pub(crate) fn chat_namespace(node_id: &str) -> String {
    format!("citadel_workspace.chat_documents.{node_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";

    #[test]
    fn a_page_keeps_the_keys_it_had() {
        assert_eq!(
            DocAddress::page("n1").key_prefix(),
            "citadel_workspace.documents.n1"
        );
    }

    #[test]
    fn a_chat_document_is_kept_apart_from_its_page_and_its_siblings() {
        let page = DocAddress::page("n1").key_prefix();
        let chat = DocAddress::chat("n1", DOC).key_prefix();
        let other = DocAddress::chat("n2", DOC).key_prefix();
        assert_ne!(page, chat);
        assert_ne!(chat, other);
        assert!(!chat.starts_with(&format!("{page}.")));
        assert!(chat.ends_with(DOC));
    }
}
