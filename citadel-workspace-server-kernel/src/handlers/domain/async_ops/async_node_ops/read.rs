//! `get_node` and `list_nodes`: reads of stored nodes.

use super::ensure_may_view_workspace;
use crate::handlers::domain::async_ops::node_views::{
    enrich_allowed_child_types, with_live_child_types, workspace_root,
};
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, NodeEntityType};
use std::collections::{HashSet, VecDeque};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    pub(super) async fn get_node_impl(
        &self,
        user_id: &str,
        node_id: &str,
    ) -> Result<DomainNode, NetworkError> {
        // Membership AND ViewContent — see ensure_may_view_workspace.
        ensure_may_view_workspace(self, user_id).await?;

        let schema = self.backend_tx_manager.get_tree_schema_or_default().await?;

        // Handle workspace-root sentinel ID (not stored as a DomainNode)
        if node_id == crate::WORKSPACE_ROOT_ID {
            let workspace = self
                .backend_tx_manager
                .get_workspace(crate::WORKSPACE_ROOT_ID)
                .await?;
            let nodes = self.backend_tx_manager.get_all_nodes_shared().await?;
            return Ok(with_live_child_types(
                workspace_root(workspace, &nodes),
                &schema,
            ));
        }

        let node = self
            .backend_tx_manager
            .get_node(node_id)
            .await?
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))?;
        Ok(with_live_child_types(node, &schema))
    }

    pub(super) async fn list_nodes_impl(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        depth: Option<u32>,
        entity_types: Option<&[NodeEntityType]>,
    ) -> Result<Vec<DomainNode>, NetworkError> {
        // Membership AND ViewContent — see ensure_may_view_workspace.
        ensure_may_view_workspace(self, user_id).await?;

        let nodes = self.backend_tx_manager.get_all_nodes_shared().await?;
        let schema = self.backend_tx_manager.get_tree_schema_or_default().await?;

        // Start from specified parent or root.
        //
        // WORKSPACE_ROOT_ID is a sentinel, not a stored DomainNode, so
        // `nodes.get("workspace-root")` is always None and the lookup below would
        // fall through to `unwrap_or_default()` — returning an empty list, with
        // Ok, on a fully populated workspace. `get_node` and `get_tree_structure`
        // both special-case the sentinel already; this listing never did. Callers
        // that pass the root explicitly (rather than None) saw an empty tree and
        // no error. Normalize it to the None branch, which is what it means.
        let parent_id = match parent_id {
            Some(pid) if pid == crate::WORKSPACE_ROOT_ID => None,
            other => other,
        };

        let start_nodes: Vec<DomainNode> = if let Some(pid) = parent_id {
            // Get children of the specified parent
            nodes
                .get(pid)
                .map(|p| {
                    p.children
                        .iter()
                        .filter_map(|cid| nodes.get(cid).cloned())
                        .collect()
                })
                .unwrap_or_default()
        } else {
            // Get root nodes (workspace level): parent_id is None or "workspace-root"
            nodes
                .values()
                .filter(|n| {
                    n.parent_id.is_none()
                        || n.parent_id.as_deref() == Some(crate::WORKSPACE_ROOT_ID)
                })
                .cloned()
                .collect()
        };

        // If depth is Some(0), return only direct children.
        // If depth is None, return ALL descendants (unlimited depth).
        if depth == Some(0) {
            let enriched = enrich_allowed_child_types(start_nodes, &schema);
            return Ok(filter_by_type(enriched, entity_types));
        }

        let max_depth = depth; // None = unlimited

        // BFS to collect nodes up to max_depth.
        //
        // `visited` protects against two classes of malformed input:
        //   1. Genuine cycles in the children graph (e.g. from a future
        //      mutation bug, a manual backend edit, or storage corruption).
        //      Without a guard, an unlimited-depth walk would loop forever
        //      and eventually OOM the server.
        //   2. Duplicate child references (the same node listed under two
        //      parents). Without a guard this produces exponential expansion
        //      even in the absence of a true cycle.
        let base_depth = start_nodes.first().map(|n| n.depth).unwrap_or(0);
        let mut result = Vec::new();
        let mut queue: VecDeque<&DomainNode> = start_nodes.iter().collect();
        let mut visited: HashSet<String> = HashSet::new();

        while let Some(node) = queue.pop_front() {
            // Skip nodes we've already processed (cycle / duplicate protection)
            if !visited.insert(node.id.clone()) {
                continue;
            }

            // Check if within depth limit (None = unlimited)
            let within_limit = match max_depth {
                Some(d) => node.depth <= base_depth + d,
                None => true, // No limit
            };
            if within_limit {
                result.push(node.clone());

                // Add children to queue
                for child_id in &node.children {
                    if let Some(child) = nodes.get(child_id) {
                        queue.push_back(child);
                    }
                }
            }
        }

        // Diagnostic warning for unbounded queries that return very large
        // result sets. `depth = None` was previously treated as `Some(0)`
        // (direct children only); the change to "unlimited descendants"
        // is intentional for the frontend's full-tree render, but a
        // surprise 50k-node response coming back to a future external
        // caller would otherwise show up only as a slow request. Logging
        // when the result exceeds a soft threshold surfaces drift early
        // without changing behaviour. Threshold picked above plausible
        // workspace sizes — bump in line with real telemetry, not a guess.
        const UNLIMITED_DEPTH_RESULT_WARN_THRESHOLD: usize = 1000;
        if depth.is_none() && result.len() > UNLIMITED_DEPTH_RESULT_WARN_THRESHOLD {
            citadel_logging::warn!(
                target: "citadel",
                "list_nodes(parent_id={:?}, depth=None) returned {} nodes (> {} soft cap) \
                 — caller is walking the full subtree; verify this is intentional",
                parent_id,
                result.len(),
                UNLIMITED_DEPTH_RESULT_WARN_THRESHOLD,
            );
        }

        let enriched = enrich_allowed_child_types(result, &schema);
        Ok(filter_by_type(enriched, entity_types))
    }
}

/// Filter nodes by entity type if filter is specified
fn filter_by_type(
    nodes: Vec<DomainNode>,
    entity_types: Option<&[NodeEntityType]>,
) -> Vec<DomainNode> {
    match entity_types {
        Some(types) if !types.is_empty() => nodes
            .into_iter()
            .filter(|n| types.contains(&n.entity_type))
            .collect(),
        _ => nodes,
    }
}
