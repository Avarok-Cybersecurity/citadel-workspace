//! "Members can see each other": the one node default that restricts anything.
//!
//! The switch is the node's `default_permissions.view_members`. Every node has
//! carried it since `ViewMembers` existed and nothing read it. Here it is
//! written (`SetMembersVisible`, EditWorkspaceConfig) and read (`ListMembers`, through
//! `kernel/roster.rs::roster_hidden`). No other node default is consulted, and
//! nothing but the roster is hidden: the scope is `ViewMembers` alone.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::platform::{SystemTime, UNIX_EPOCH};
use crate::WorkspaceProtocolResponse;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, Permission};
use std::collections::HashMap;

/// Whether the roster at the end of `path` is hidden from a non-admin: some
/// node on the path has its switch off. Workspace levels are not nodes and
/// have no switch.
pub(crate) fn hidden_on_path(nodes: &HashMap<String, DomainNode>, path: &[String]) -> bool {
    crate::kernel::roster::roster_hidden(path, |level| {
        nodes
            .get(level)
            .is_some_and(|node| !node.default_permissions.view_members)
    })
}

/// Who may switch a roster off, and so who still sees a hidden one.
///
/// The workspace's configuration permission. It was the Admin role, on the grounds that no
/// grantable permission should decide who sees the list; with roles editable, an Admin choosing
/// to give this to a role is exactly that decision, made by someone entitled to make it.
pub(super) const SWITCHES_ROSTER_VISIBILITY: Permission = Permission::EditWorkspaceConfig;

/// Store the switch on `node_id` and announce the node to everyone on it.
pub(super) async fn set_members_visible<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    actor_user_id: &str,
    requester_cid: Option<u64>,
    node_id: &str,
    visible: bool,
) -> Result<WorkspaceProtocolResponse, NetworkError> {
    let may_switch = kernel
        .domain_operations
        .holds_workspace_permission(actor_user_id, SWITCHES_ROSTER_VISIBILITY)
        .await
        .unwrap_or(false);
    if !may_switch {
        return Ok(WorkspaceProtocolResponse::Error(
            "Permission denied: EditWorkspaceConfig is required to change who sees the member list"
                .to_string(),
        ));
    }

    let backend = &kernel.domain_operations.backend_tx_manager;
    let node = {
        // Read and write under one lock, as update_node does: a concurrent
        // edit to another field must not be reverted by this save.
        let _nodes_guard = backend.lock_nodes().await;
        let mut nodes = backend.get_all_nodes().await?;
        let Some(node) = nodes.get_mut(node_id) else {
            return Ok(WorkspaceProtocolResponse::Error(format!(
                "Node '{node_id}' not found"
            )));
        };
        node.default_permissions.view_members = visible;
        node.updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let node = node.clone();
        backend.save_nodes(&nodes).await?;
        node
    };

    // Everyone on the node holds the tree, and the admins' settings read it.
    kernel.broadcast_to_node(
        WorkspaceProtocolResponse::Node(node.clone()),
        requester_cid,
        node.id.clone(),
    );
    Ok(WorkspaceProtocolResponse::Node(node))
}
