//! Pictures in a page's or a chat document's document (`citadel_workspace_types::document_pictures`),
//! as the kernel keeps them. Pure: where each document's pictures are stored, and how many and how
//! large they may be.
//!
//! Each document's pictures are app-storage blobs under a storage root of its own (`root_of`), so
//! they are chunked, counted toward the workspace's storage, and purged by the code app blobs are.
//! No app can own those roots: their app id is not one an app may have. A picture is kept until
//! its document is deleted: a node delete purges the roots of its page and of every chat document
//! that ever stored a picture there, which the node's index of document roots names.

use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::chat_attachments::ChatAttachmentLimits;
use crate::kernel::documents::address::DocAddress;
use citadel_workspace_types::chat_documents::is_chat_document_id;
use citadel_workspace_types::document_pictures::PictureDocument;

/// The app id of every document's picture root. Not a valid app id (`citadel_app_id`:
/// dot-separated lowercase labels), so no app's root can be one of these.
pub const DOCUMENT_PICTURES_ROOT: &str = "sys/document-pictures";

/// What a server lets one document keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocumentPictureLimits {
    /// The largest picture, in bytes; 0 keeps none.
    pub max_bytes: u64,
    /// The most pictures one document keeps; it bounds the document's ledger, one record read and
    /// written whole under `APPS_LOCK`.
    pub max_pictures_per_document: u32,
}

impl DocumentPictureLimits {
    /// The limits a server's chat files are configured with (`resolve_chat_attachment_limits`),
    /// not a key of their own: a picture is the same kind of thing, a file a member uploads and
    /// the server keeps under a node, counted against the same storage, and a new required key
    /// would stop every existing server's `kernel.toml` from starting. The largest picture is the
    /// largest chat file, and a document keeps as many pictures as a node keeps chat files.
    pub fn of_chat_attachments(limits: ChatAttachmentLimits) -> Self {
        Self {
            max_bytes: limits.max_bytes,
            max_pictures_per_document: limits.max_files_per_node,
        }
    }
}

/// The document `doc` names: a page, or a chat document whose id is one (`None` otherwise, which
/// the gate refuses before any key is made from it).
pub(crate) fn address_of(doc: &PictureDocument) -> Option<DocAddress> {
    match &doc.chat_doc {
        None => Some(DocAddress::page(&doc.node_id)),
        Some(chat_doc) if is_chat_document_id(chat_doc) => {
            Some(DocAddress::chat(&doc.node_id, chat_doc))
        }
        Some(_) => None,
    }
}

/// Where `doc`'s pictures are stored: keyed by the document's log address, which is distinct for a
/// page and each chat document (`DocAddress::key_prefix`).
pub(crate) fn root_of(doc: &DocAddress) -> StorageRoot {
    root_of_scope(doc.key_prefix())
}

/// The root a node's index of document roots names by its scope key.
pub fn root_of_scope(scope_key: String) -> StorageRoot {
    StorageRoot {
        app_id: DOCUMENT_PICTURES_ROOT.to_string(),
        scope_key,
    }
}

/// Where every member's picture upload in progress is counted (`UploadSlot::DocumentPicture`),
/// one namespace per member, as a chat upload's is (`chat_attachments::staging_root`).
pub fn staging_root() -> StorageRoot {
    root_of_scope("staging".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b";

    fn picture_doc(chat_doc: Option<&str>) -> PictureDocument {
        PictureDocument {
            node_id: "n1".to_string(),
            chat_doc: chat_doc.map(str::to_string),
        }
    }

    #[test]
    fn each_document_has_a_root_of_its_own() {
        let page = root_of(&address_of(&picture_doc(None)).expect("a page")).id();
        let chat = root_of(&address_of(&picture_doc(Some(DOC))).expect("a chat doc")).id();
        assert_ne!(page, chat);
        assert_ne!(page, staging_root().id());
        assert_ne!(
            page,
            crate::kernel::chat_attachments::root_of("n1").id(),
            "a page's pictures share the node's chat files' root"
        );
    }

    #[test]
    fn a_chat_doc_that_is_not_a_chat_documents_id_names_no_document() {
        assert_eq!(address_of(&picture_doc(Some("../n2"))), None);
        assert_eq!(address_of(&picture_doc(Some(""))), None);
    }
}
