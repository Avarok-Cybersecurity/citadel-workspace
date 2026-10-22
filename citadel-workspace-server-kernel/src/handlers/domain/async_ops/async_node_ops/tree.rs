//! `get_tree_structure`: the node tree, built iteratively.

use super::ensure_may_view_workspace;
use crate::handlers::domain::async_ops::node_views::{enrich_tree, unnamed_root, workspace_root};
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, TreeNode};
use std::collections::{HashSet, VecDeque};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    pub(super) async fn get_tree_structure_impl(
        &self,
        user_id: &str,
        root_id: Option<&str>,
        max_depth: Option<u32>,
    ) -> Result<TreeNode, NetworkError> {
        // Membership AND ViewContent — see ensure_may_view_workspace.
        ensure_may_view_workspace(self, user_id).await?;

        let nodes = self.backend_tx_manager.get_all_nodes_shared().await?;

        let schema = self.backend_tx_manager.get_tree_schema_or_default().await?;

        // Find the root node
        let root_node = match root_id {
            // The workspace-root sentinel is a workspace record, never a stored node.
            Some(rid) if rid == crate::WORKSPACE_ROOT_ID => {
                let workspace = self
                    .backend_tx_manager
                    .get_workspace(crate::WORKSPACE_ROOT_ID)
                    .await?;
                workspace_root(workspace, &nodes)
            }
            Some(rid) => nodes
                .get(rid)
                .ok_or_else(|| NetworkError::msg(format!("Root node '{}' not found", rid)))?
                .clone(),
            // No root_id specified - find workspace root node or create synthetic one
            None => nodes
                .values()
                .find(|n| n.parent_id.is_none())
                .cloned()
                .unwrap_or_else(|| unnamed_root(&nodes)),
        };

        Ok(enrich_tree(
            build_tree(root_node, &nodes, max_depth),
            &schema,
        ))
    }
}

/// Iterative tree construction. The previous recursive implementation
/// walked `node.children` unconditionally with NO cycle guard and no cap
/// on recursion depth: a cyclic or duplicate child reference would recurse
/// forever, and even a well-formed but deep (a few thousand levels)
/// hierarchy called with `max_depth: None` would overflow the stack. This
/// version adds both protections (a `visited` set and an explicit queue).
///
/// This is BFS + reverse-depth assembly, mirroring the iterative pattern
/// `list_nodes` uses in the same file. Two phases:
///   1. BFS the children graph from `root` to collect every node that
///      should appear in the tree (respecting `max_depth`), recording
///      each node's depth and pruning cycles/duplicate child refs.
///   2. Build TreeNode entries in an arena (`HashMap<id, TreeNode>`),
///      then iterate from the deepest collected nodes to the root and
///      `arena.remove` each child into its parent's `children` vec.
///      Processing deepest-first guarantees every child TreeNode is
///      ready before its parent assembles.
///
/// Cycle/duplicate protection is preserved (the `visited` set in phase 1
/// drops already-seen ids), and the resulting tree shape is identical to
/// the recursive version for any well-formed input.
fn build_tree(
    root: DomainNode,
    nodes: &std::collections::HashMap<String, DomainNode>,
    max_depth: Option<u32>,
) -> TreeNode {
    let root_id = root.id.clone();

    // Phase 1: BFS to collect (node, depth) in discovery order, plus a
    // separate `bounded_children` map that records only the children
    // actually expanded from each node (i.e. respecting `max_depth` and
    // the visited/cycle guard). We CANNOT use `node.children` directly
    // in phase 2 because cyclic / cross-parent / out-of-depth references
    // would either reattach a node we already removed from the arena
    // (e.g. a back-edge from a leaf to the root) or attach a node that
    // was deliberately pruned.
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(root_id.clone());
    let mut included: Vec<(DomainNode, u32)> = Vec::new();
    let mut bounded_children: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut queue: VecDeque<(DomainNode, u32)> = VecDeque::new();
    queue.push_back((root, 0));

    while let Some((node, depth)) = queue.pop_front() {
        let node_id = node.id.clone();
        let child_ids = node.children.clone();
        included.push((node, depth));

        // Stop expanding past max_depth — the popped node still appears
        // as a leaf (no children) in the final tree, same as the
        // recursive behaviour.
        let can_expand = max_depth.map(|m| depth < m).unwrap_or(true);
        if !can_expand {
            continue;
        }

        let mut accepted_children = Vec::new();
        for child_id in child_ids {
            if !visited.insert(child_id.clone()) {
                continue;
            }
            if let Some(child) = nodes.get(&child_id) {
                accepted_children.push(child_id.clone());
                queue.push_back((child.clone(), depth + 1));
            }
        }
        bounded_children.insert(node_id, accepted_children);
    }

    // Phase 2: Pre-create empty TreeNode entries for the NON-ROOT nodes,
    // then wire up children deepest-first so a parent never tries to
    // assemble a child that hasn't been built yet. Use `bounded_children`
    // (not `node.children`) so back-edges in cyclic input do not try to
    // move an already-assembled ancestor out of the arena.
    //
    // The root TreeNode lives in its own local instead of the arena so a
    // future refactor that changes the phase-2 sort order can never strand
    // us with the root removed mid-iteration. The previous implementation
    // ended on `arena.remove(&root_id).expect(...)`, which would panic the
    // server process on the very rebuild it was trying to recover from.
    let root_domain = included
        .iter()
        .find(|(n, _)| n.id == root_id)
        .map(|(n, _)| n.clone())
        .expect("BFS phase 1 pushed the root into `included`");
    let mut arena: std::collections::HashMap<String, TreeNode> = included
        .iter()
        .filter(|(n, _)| n.id != root_id)
        .map(|(n, _)| {
            (
                n.id.clone(),
                TreeNode {
                    node: n.clone(),
                    children: vec![],
                },
            )
        })
        .collect();
    let mut root_tree = TreeNode {
        node: root_domain,
        children: vec![],
    };

    included.sort_by_key(|(_, d)| std::cmp::Reverse(*d));
    for (node, _depth) in included {
        let child_ids = bounded_children.remove(&node.id).unwrap_or_default();
        let mut child_trees = Vec::with_capacity(child_ids.len());
        for child_id in &child_ids {
            if let Some(child_tree) = arena.remove(child_id) {
                child_trees.push(child_tree);
            }
        }
        if node.id == root_id {
            root_tree.children = child_trees;
        } else if let Some(tree) = arena.get_mut(&node.id) {
            tree.children = child_trees;
        }
    }

    root_tree
}

#[cfg(test)]
mod build_tree_tests;
