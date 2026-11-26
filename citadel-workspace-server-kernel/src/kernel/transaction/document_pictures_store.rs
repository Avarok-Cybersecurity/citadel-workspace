//! Document pictures at rest (`kernel::document_pictures`). Nothing is decided here; the caller
//! holds `APPS_LOCK`, which every write to a storage root's ledger is made under and which a node
//! delete holds across its purge.
//!
//! - `citadel_workspace.document_pictures.<node id>`: the scope keys of every document of the
//!   node (its page, its chat documents) whose picture root may hold anything, entered before the
//!   root's ledger first names bytes, so the node's purge finds each one.
//! - The bytes: each document's `document_pictures::root_of` blobs and ledger (`apps_kv_store`).

use super::BackendTransactionManager;
use crate::kernel::apps::storage::StorageRoot;
use crate::kernel::document_pictures::{root_of, root_of_scope};
use crate::kernel::documents::address::DocAddress;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use std::collections::BTreeSet;

fn roots_key(node_id: &str) -> String {
    format!("citadel_workspace.document_pictures.{node_id}")
}

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    async fn picture_scopes(&self, node_id: &str) -> Result<BTreeSet<String>, NetworkError> {
        Ok(self
            .backend_get(&roots_key(node_id))
            .await?
            .unwrap_or_default())
    }

    /// Store `bytes`, whose SHA-256 the caller verified is `digest`, as one of `doc`'s pictures:
    /// the document in its node's index first, then the root's ledger, then the chunks.
    pub(crate) async fn store_document_picture(
        &self,
        doc: &DocAddress,
        digest: &str,
        bytes: &[u8],
    ) -> Result<(), NetworkError> {
        let root: StorageRoot = root_of(doc);
        let mut scopes = self.picture_scopes(&doc.node_id).await?;
        if scopes.insert(root.scope_key.clone()) {
            self.backend_save(&roots_key(&doc.node_id), &scopes).await?;
        }
        self.keep_blob(&root, digest, bytes).await
    }

    /// Delete every picture of every document of `node_id`, and the index: what deleting the node
    /// does. The index names every root that ever stored a picture, so this reaches chat documents
    /// whose own list never came to name them.
    pub(crate) async fn purge_document_pictures(&self, node_id: &str) -> Result<(), NetworkError> {
        for scope_key in self.picture_scopes(node_id).await? {
            self.purge_app_storage(&root_of_scope(scope_key)).await?;
        }
        self.backend_delete(&roots_key(node_id)).await
    }
}
