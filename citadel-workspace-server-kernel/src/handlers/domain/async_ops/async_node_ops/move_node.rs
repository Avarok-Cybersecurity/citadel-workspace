//! `move_node`: a node and its subtree under a new parent.

use super::current_timestamp;
use crate::handlers::domain::async_ops::node_views::with_live_child_types;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::tree_validator::{NodeMutation, TreeValidator};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, Permission};

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    pub(super) async fn move_node_impl(
        &self,
        user_id: &str,
        node_id: &str,
        new_parent_id: Option<&str>,
    ) -> Result<DomainNode, NetworkError> {
        // Check permission
        if !self
            .check_entity_permission(
                user_id,
                crate::WORKSPACE_ROOT_ID,
                Permission::EditTreeStructure,
            )
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: EditTreeStructure required",
            ));
        }

        // Must have a new parent (moving to root not allowed for non-workspace nodes)
        let new_parent_id = new_parent_id.ok_or_else(|| {
            NetworkError::msg("Cannot move node to root level - new_parent_id is required")
        })?;

        // Get all nodes
        // Serialize the whole read-modify-write below. The nodes collection is
        // one HashMap-shaped backend key, so `get_all_nodes` ... `save_nodes`
        // is a load-modify-save cycle: without this, two concurrent callers
        // both load the prior map and the second save silently drops the
        // other's node. The per-mutator lock does not cover this path because
        // the cycle spans our own awaits, not one mutator's.
        let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
        let mut nodes = self.backend_tx_manager.get_all_nodes().await?;

        // Get schema for validation
        let schema = self.backend_tx_manager.get_tree_schema_or_default().await?;

        // Validate the move
        let mutation = NodeMutation::Move {
            node_id: String::from(node_id),
            new_parent_id: String::from(new_parent_id),
        };
        TreeValidator::validate_mutation_with_schema(&nodes, &mutation, &schema)
            .map_err(|e| NetworkError::msg(format!("Tree validation failed: {}", e)))?;

        // Get the node being moved
        let node = nodes
            .get(node_id)
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))?
            .clone();

        // Check if moving to workspace-root sentinel
        let is_moving_to_workspace_root = new_parent_id == crate::WORKSPACE_ROOT_ID;

        // Calculate depth change
        // workspace-root has depth 0, so children have depth 1
        let old_depth = node.depth;
        let new_depth = if is_moving_to_workspace_root {
            1 // Direct child of workspace root
        } else {
            let new_parent = nodes.get(new_parent_id).ok_or_else(|| {
                NetworkError::msg(format!("New parent node '{}' not found", new_parent_id))
            })?;
            new_parent.depth + 1
        };
        let depth_diff = new_depth as i32 - old_depth as i32;

        // Remove from old parent's children list
        if let Some(old_parent_id) = &node.parent_id {
            if old_parent_id != crate::WORKSPACE_ROOT_ID {
                if let Some(old_parent) = nodes.get_mut(old_parent_id) {
                    old_parent.children.retain(|c| c != node_id);
                }
            }
        }

        // Add to new parent's children list (skip for workspace-root which isn't stored)
        if !is_moving_to_workspace_root {
            if let Some(new_parent_node) = nodes.get_mut(new_parent_id) {
                let node_id_owned = String::from(node_id);
                if !new_parent_node.children.contains(&node_id_owned) {
                    new_parent_node.children.push(node_id_owned);
                }
            }
        }

        // Update the node's parent and depth
        if let Some(moving_node) = nodes.get_mut(node_id) {
            moving_node.parent_id = Some(String::from(new_parent_id));
            moving_node.depth = new_depth;
            moving_node.updated_at = current_timestamp();
        }

        // Update depths of all descendants
        let descendants = TreeValidator::get_descendants(&nodes, node_id);
        for desc_id in descendants {
            if let Some(desc_node) = nodes.get_mut(&desc_id) {
                desc_node.depth = ((desc_node.depth as i32) + depth_diff) as u32;
                desc_node.updated_at = current_timestamp();
            }
        }

        // Save all nodes
        self.backend_tx_manager.save_nodes(&nodes).await?;

        // Return the updated node
        nodes
            .get(node_id)
            .cloned()
            .map(|node| with_live_child_types(node, &schema))
            .ok_or_else(|| NetworkError::msg("Node disappeared after move"))
    }
}
