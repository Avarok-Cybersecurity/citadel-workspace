//! `storage.node.authored` at rest (Calendar design §3.3.1): listing every author's keys on a
//! node, and keeping the node's roster of authors in step with each write. The decisions are
//! `kernel::apps::storage_authored`'s; this reads and saves what they name.
//!
//! The caller holds `APPS_LOCK` for `save_roster`, as for every write. A listing reads without
//! it: each author's index is read whole, so a page never shows half a write, and a write landing
//! between two indexes shows on the next page or the next read.

use super::apps::Step;
use super::apps_call::reply_ok;
use super::apps_call_storage::refused;
use crate::kernel::apps::storage::{KvIndex, Namespace, StorageLedger, StorageRoot};
use crate::kernel::apps::storage_authored::{
    authors_from, decode_cursor, roster_after, AuthoredPager,
};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_app_sdk_types::calls::KvListAuthored;
use citadel_sdk::prelude::Ratchet;

/// One page of every author's keys under the call's prefix on its node.
pub(super) async fn list_authored<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    root: &StorageRoot,
    list: &KvListAuthored,
) -> Step<Vec<u8>> {
    let cursor = match list.cursor.as_deref().map(decode_cursor).transpose() {
        Ok(cursor) => cursor,
        Err(why) => return Ok(refused(why)),
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let roster = backend.kv_index(&root.roster_id(&list.node_id)).await?;
    let mut pager = AuthoredPager::new(&list.prefix, cursor);
    for author in authors_from(&roster, cursor) {
        let namespace = Namespace::NodeAuthored {
            node: list.node_id.clone(),
            author: author.to_string(),
        };
        let index = backend.kv_index(&root.namespace_id(&namespace)).await?;
        if pager.take(author, &index) {
            break;
        }
    }
    Ok(reply_ok(pager.finish()))
}

/// With `APPS_LOCK` held: list or unlist the author of `namespace` on its node's roster, now
/// that their namespace is `next`, recording the roster in `ledger` so a purge removes it.
pub(super) async fn save_roster<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    root: &StorageRoot,
    namespace: &Namespace,
    next: &KvIndex,
    ledger: &mut StorageLedger,
) -> Step<()> {
    let Namespace::NodeAuthored { node, author } = namespace else {
        return Ok(());
    };
    let backend = &kernel.domain_operations.backend_tx_manager;
    let id = root.roster_id(node);
    let roster = backend.kv_index(&id).await?;
    if let Some(changed) = roster_after(&roster, author, next) {
        backend.save_kv_index(&id, &changed).await?;
        ledger.record_namespace(id, changed.usage());
    }
    Ok(())
}
