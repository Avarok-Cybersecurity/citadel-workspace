//! The kernel's own writes to a document's required-apps header: injecting an install's
//! requirement and removing it again. The rewrite is decided by `kernel::apps::md_header`; this
//! stores it the way `update_node` stores content (hash computed here, where it is stored) and
//! tells the node's viewers, so an open editor does not save over it with the old header.

use super::apps::{Caller, Step};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::WorkspaceProtocolResponse;
use citadel_logging::warn;
use citadel_sdk::prelude::Ratchet;
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_md_header::HeaderRefusal;
use citadel_workspace_types::structs::mdx_content_hash;

/// Apply `rewrite` to `node_id`'s content under the nodes lock. `Ok(false)` when it had nothing
/// to change or the node is gone. A document whose header cannot be read or written is
/// refused as a limit: the kernel never repairs a header it did not write.
pub(super) async fn rewrite_mdx<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    node_id: &str,
    rewrite: impl FnOnce(&str) -> Result<Option<String>, HeaderRefusal>,
) -> Step<bool> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let written = {
        let _nodes_guard = backend.lock_nodes().await;
        let mut nodes = backend.get_all_nodes().await?;
        let Some(node) = nodes.get_mut(node_id) else {
            return Ok(false);
        };
        let Some(content) = rewrite(&node.mdx_content)
            .map_err(|why| AppsRefusal::Limit(format!("the document's apps header: {why:?}")))?
        else {
            return Ok(false);
        };
        node.mdx_content = content;
        node.mdx_content_hash = Some(mdx_content_hash(&node.mdx_content));
        node.updated_at = caller.now / 1000;
        let written = node.clone();
        backend.save_nodes(&nodes).await?;
        written
    };
    let response = WorkspaceProtocolResponse::NodeContentUpdated {
        node_id: node_id.to_string(),
        mdx_content: written.mdx_content.clone(),
        mdx_content_hash: written.mdx_content_hash.clone(),
        updated_by: caller.user.to_string(),
        timestamp: caller.now / 1000,
    };
    kernel.broadcast_to_node(response, caller.cid, node_id.to_string());
    let segments = kernel.content_path_segments(node_id).await;
    if let Err(e) = kernel
        .persist_node_content_at(&segments, &written.mdx_content)
        .await
    {
        warn!(target: "citadel", "The apps header of {node_id} was stored but not persisted to its file: {e}");
    }
    Ok(true)
}
