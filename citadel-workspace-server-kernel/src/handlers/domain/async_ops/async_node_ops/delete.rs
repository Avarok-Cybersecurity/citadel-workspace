//! `delete_node`: a node, its descendants on cascade, and the history they held.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::tree_validator::{NodeMutation, TreeValidator};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::Permission;

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    pub(super) async fn delete_node_impl(
        &self,
        user_id: &str,
        node_id: &str,
        cascade: bool,
    ) -> Result<Vec<String>, NetworkError> {
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

        // Get all nodes for validation and manipulation
        // Serialize the whole read-modify-write below. The nodes collection is
        // one HashMap-shaped backend key, so `get_all_nodes` ... `save_nodes`
        // is a load-modify-save cycle: without this, two concurrent callers
        // both load the prior map and the second save silently drops the
        // other's node. The per-mutator lock does not cover this path because
        // the cycle spans our own awaits, not one mutator's.
        let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
        let mut nodes = self.backend_tx_manager.get_all_nodes().await?;

        // Validate delete mutation
        let mutation = NodeMutation::Delete {
            node_id: String::from(node_id),
        };
        TreeValidator::validate_mutation(&nodes, &mutation)
            .map_err(|e| NetworkError::msg(format!("Tree validation failed: {}", e)))?;

        // Get the node to delete
        let node = nodes
            .get(node_id)
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))?
            .clone();

        // Check if node has children
        if !node.children.is_empty() && !cascade {
            return Err(NetworkError::msg(format!(
                "Node '{}' has {} children. Use cascade=true to delete with children.",
                node_id,
                node.children.len()
            )));
        }

        // Collect all nodes to delete
        let mut deleted_ids = Vec::new();

        if cascade {
            // Get all descendants using TreeValidator helper
            let mut descendants = TreeValidator::get_descendants(&nodes, node_id);
            deleted_ids.append(&mut descendants);
        }

        // Add the node itself
        deleted_ids.push(String::from(node_id));

        // Remove from parent's children list
        if let Some(parent_id) = &node.parent_id {
            if let Some(parent) = nodes.get_mut(parent_id) {
                parent.children.retain(|c| c != node_id);
            }
        }

        // The chat channels those nodes owned, captured BEFORE they are removed
        // -- once the node is gone there is nothing left that knows its
        // `chat_channel_id`, which is the only key its history is stored under.
        let deleted_channels: Vec<String> = deleted_ids
            .iter()
            .filter_map(|id| nodes.get(id).and_then(|n| n.chat_channel_id.clone()))
            .collect();

        // And the messages those rooms held. Removing the node removed the only
        // reference to `citadel_workspace.group_messages.<key>`; the messages
        // themselves stayed in the backend forever, unreachable and so
        // unpurgeable. A room that is deleted has to take its history with it.
        //
        // Keyed by `chat_channel_id`, NOT by node id. `group_access` states the
        // rule -- "a `group_id` is a node's `chat_channel_id`" -- and this loop
        // passed the node id, so it deleted a key that had never existed and
        // every deleted room's history survived exactly as before. A node with
        // no chat channel has no history and contributes nothing here.
        //
        // BEFORE the nodes are saved, not after. An earlier ordering saved the
        // tree first, reasoning that a failed purge was "recoverable by
        // deleting again" -- but it was not: the save had already removed the
        // node, so a retry hit `validate_delete`'s NodeNotFound, and with the
        // node gone nothing knew the channel key any more. A purge failure
        // after the save therefore returned Err for a deletion that had
        // persisted, AND orphaned the remaining channels' history forever.
        // Failing HERE leaves the tree untouched in the backend (the map above
        // is only in memory), so deleting again genuinely retries: already
        // purged channels purge again as no-ops, the rest get their turn, and
        // the state converges. The worst partial state -- some history gone,
        // room still listed -- is repaired by the same retry.
        for channel_id in &deleted_channels {
            self.backend_tx_manager
                .delete_all_group_messages(channel_id)
                .await?;
        }

        // And their document logs, before the save for the same reason. Their locks are held
        // until this returns, past the save: an append racing the delete either lands before
        // the purge and goes with it, or finds the node gone (`documents_store`).
        let _document_guards = self.backend_tx_manager.lock_documents(&deleted_ids).await;
        for id in &deleted_ids {
            self.backend_tx_manager.delete_document_log(id).await?;
        }

        // Remove all deleted nodes
        for id in &deleted_ids {
            nodes.remove(id);
        }

        // Save updated nodes
        self.backend_tx_manager.save_nodes(&nodes).await?;

        Ok(deleted_ids)
    }
}
