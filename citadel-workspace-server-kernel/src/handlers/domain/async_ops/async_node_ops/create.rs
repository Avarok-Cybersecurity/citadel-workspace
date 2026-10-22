//! `create_node`: a new node under a parent the schema allows.

use super::current_timestamp;
use crate::handlers::domain::async_ops::node_chat::{set_chat_enabled, NEW_NODE_CHAT_ENABLED};
use crate::handlers::domain::async_ops::node_views::with_live_child_types;
use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::server_ops::node_metadata::new_node_metadata;
use crate::handlers::domain::tree_validator::{NodeMutation, TreeValidator};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType, Permission};

/// Entity type name constants to avoid repeated string allocations
mod type_names {
    pub const WORKSPACE: &str = "Workspace";
}

impl<R: Ratchet + Send + Sync + 'static> AsyncDomainServerOperations<R> {
    pub(super) async fn create_node_impl(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        entity_type: &NodeEntityType,
        name: &str,
        description: &str,
        metadata: Option<&[u8]>,
    ) -> Result<DomainNode, NetworkError> {
        // Before any lock or write: a document no merge could build on is never stored.
        let metadata = new_node_metadata(metadata).map_err(NetworkError::msg)?;

        // Validate: Workspace type can only be created at root level
        if entity_type.is_workspace() && parent_id.is_some() {
            return Err(NetworkError::msg(
                "Workspace nodes can only exist at root level (no parent)",
            ));
        }

        // Validate: Non-workspace types require a parent
        if !entity_type.is_workspace() && parent_id.is_none() {
            return Err(NetworkError::msg("Non-workspace nodes must have a parent"));
        }

        // Check permission - need EditTreeStructure permission on the workspace
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

        // Get current nodes for validation
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

        // Determine depth and validate parent exists
        // Special cases for workspace as parent:
        // 1. WORKSPACE_ROOT_ID ("workspace-root") - single workspace mode
        // 2. Valid workspace ID from workspace storage - multi-workspace mode
        let (depth, parent_node_type) = if let Some(pid) = parent_id {
            if pid == crate::WORKSPACE_ROOT_ID {
                // Creating child directly under workspace root (single workspace mode)
                (1, type_names::WORKSPACE)
            } else if let Some(parent) = nodes.get(pid) {
                // Parent is a DomainNode
                (parent.depth + 1, parent.entity_type.type_name())
            } else if self.backend_tx_manager.get_workspace(pid).await?.is_some() {
                // Parent is a workspace ID (multi-workspace mode)
                (1, type_names::WORKSPACE)
            } else {
                return Err(NetworkError::msg(format!(
                    "Parent node '{}' not found",
                    pid
                )));
            }
        } else {
            (0, "")
        };

        // Generate unique node ID
        let node_id = uuid::Uuid::new_v4().to_string();

        // Validate mutation with schema
        let mutation = NodeMutation::Create {
            node_id: node_id.clone(),
            parent_id: parent_id.map(str::to_string),
            node_type: entity_type.type_name().to_string(),
            depth,
        };

        TreeValidator::validate_mutation_with_schema(&nodes, &mutation, &schema)
            .map_err(|e| NetworkError::msg(format!("Tree validation failed: {}", e)))?;

        // Also check schema child type rules if parent exists
        if !parent_node_type.is_empty()
            && !schema.is_child_allowed(parent_node_type, entity_type.type_name())
        {
            return Err(NetworkError::msg(format!(
                "Child type '{}' not allowed under parent type '{}'",
                entity_type.type_name(),
                parent_node_type
            )));
        }

        let now = current_timestamp();

        // Create the node
        let mut node = DomainNode {
            id: node_id.clone(),
            parent_id: parent_id.map(String::from),
            entity_type: entity_type.clone(),
            depth,
            name: String::from(name),
            description: String::from(description),
            owner_id: String::from(user_id),
            members: vec![String::from(user_id)],
            children: vec![],
            mdx_content: String::new(),
            mdx_content_hash: None,
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            metadata,
            // Derived from the live schema on every read (node_views), never stored.
            allowed_child_types: None,
            is_default: false,
            created_at: now,
            updated_at: now,
        };
        set_chat_enabled(&mut node, NEW_NODE_CHAT_ENABLED);

        // Insert the node
        nodes.insert(node_id.clone(), node.clone());

        // Update parent's children list if applicable
        if let Some(pid) = parent_id {
            if let Some(parent) = nodes.get_mut(pid) {
                if !parent.children.contains(&node_id) {
                    parent.children.push(node_id.clone());
                }
            }
        }

        // Save all nodes
        self.backend_tx_manager.save_nodes(&nodes).await?;

        Ok(with_live_child_types(node, &schema))
    }
}
