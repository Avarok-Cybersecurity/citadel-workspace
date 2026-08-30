//! # Async Node Operations Implementation
//!
//! This module implements AsyncNodeOperations for AsyncDomainServerOperations,
//! providing the generalized tree hierarchy node operations.

use crate::handlers::domain::async_ops::AsyncPermissionOperations;
use crate::handlers::domain::node_ops::AsyncNodeOperations;
use crate::handlers::domain::server_ops::async_domain_server_ops::AsyncDomainServerOperations;
use crate::handlers::domain::tree_validator::{NodeMutation, TreeValidator};
use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, Permission, TreeNode, TreeSchema,
};
use std::collections::{HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

/// Entity type name constants to avoid repeated string allocations
mod type_names {
    pub const WORKSPACE: &str = "Workspace";
}

/// Default synthetic node values
mod defaults {
    pub const ROOT_NAME: &str = "Root Workspace";
    pub const ROOT_DESC: &str = "Root workspace";
    pub const UNKNOWN_OWNER: &str = "unknown";
    pub const WORKSPACE_LABEL: &str = "Workspace";
}

/// Get current unix timestamp in seconds
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[async_trait]
impl<R: Ratchet + Send + Sync + 'static> AsyncNodeOperations<R> for AsyncDomainServerOperations<R> {
    async fn create_node(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        entity_type: &NodeEntityType,
        name: &str,
        description: &str,
    ) -> Result<DomainNode, NetworkError> {
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

        // Derive allowed child types from the tree schema (SSOT)
        let allowed_child_types = schema
            .rules
            .iter()
            .find(|r| r.parent_type == entity_type.type_name())
            .map(|r| r.allowed_child_types.clone());

        // Create the node
        let node = DomainNode {
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
            metadata: vec![],
            allowed_child_types,
            is_default: false,
            created_at: now,
            updated_at: now,
        };

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

        Ok(node)
    }

    async fn get_node(&self, user_id: &str, node_id: &str) -> Result<DomainNode, NetworkError> {
        // Check if user is member of workspace (basic access check)
        if !self
            .is_member_of_domain(user_id, crate::WORKSPACE_ROOT_ID)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: Not a member of this workspace",
            ));
        }

        // Handle workspace-root sentinel ID (not stored as a DomainNode)
        if node_id == crate::WORKSPACE_ROOT_ID {
            let workspace = self
                .backend_tx_manager
                .get_workspace(crate::WORKSPACE_ROOT_ID)
                .await?;
            let (name, description, owner_id, members) = if let Some(ws) = workspace {
                (
                    ws.name.clone(),
                    ws.description.clone(),
                    ws.owner_id.clone(),
                    ws.members.clone(),
                )
            } else {
                (
                    String::from(defaults::ROOT_NAME),
                    String::from(defaults::ROOT_DESC),
                    String::from(defaults::UNKNOWN_OWNER),
                    vec![],
                )
            };

            let nodes = self.backend_tx_manager.get_all_nodes().await?;
            let children: Vec<String> = nodes
                .values()
                .filter(|n| n.parent_id.as_deref() == Some(crate::WORKSPACE_ROOT_ID))
                .map(|n| n.id.clone())
                .collect();

            return Ok(DomainNode {
                id: String::from(crate::WORKSPACE_ROOT_ID),
                parent_id: None,
                entity_type: NodeEntityType::Workspace,
                depth: 0,
                name,
                description,
                owner_id,
                members,
                children,
                mdx_content: String::new(),
                mdx_content_hash: None,
                rules: None,
                chat_enabled: false,
                chat_channel_id: None,
                default_permissions: DomainPermissions::default(),
                metadata: vec![],
                allowed_child_types: None,
                is_default: true,
                created_at: 0,
                updated_at: 0,
            });
        }

        // Get the node from storage
        self.backend_tx_manager
            .get_node(node_id)
            .await?
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))
    }

    async fn update_node(
        &self,
        user_id: &str,
        node_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        rules: Option<&str>,
        chat_enabled: Option<bool>,
        is_default: Option<bool>,
    ) -> Result<DomainNode, NetworkError> {
        // Gate on what is actually being changed, at the node being changed.
        //
        // Every update required EditTreeStructure at WORKSPACE_ROOT_ID, so
        // saving a document — which changes no structure at all — was refused
        // unless the user could restructure the entire workspace. That is not a
        // permission any custom role receives: `Permission::for_role` never
        // inserts EditTreeStructure for Custom, while EditMdx is directly
        // grantable in the permission matrix. So an admin could grant exactly
        // the persona ("can edit MDX documents") whose every save was refused,
        // while the UI — which gates its Edit button on EditMdx — correctly
        // enabled it. The two ends disagreed about which permission the feature
        // needs.
        //
        // Scoped to `node_id` rather than the root because
        // check_entity_permission walks UP the parent chain, so a grant at the
        // root still covers every descendant: node-scoped is strictly more
        // precise here, never less permissive.
        // One list, shared with the broadcast decision in the command processor.
        // They were separate copies and drifted -- see `update_changes_structure`.
        let changes_structure = crate::handlers::domain::node_ops::update_changes_structure(
            name,
            description,
            rules,
            chat_enabled,
            is_default,
        );

        let (required, label) = if changes_structure {
            (Permission::EditTreeStructure, "EditTreeStructure")
        } else {
            (Permission::EditMdx, "EditMdx")
        };

        if !self
            .check_entity_permission(user_id, node_id, required)
            .await?
        {
            return Err(NetworkError::msg(format!(
                "Permission denied: {label} required"
            )));
        }

        // Hold the nodes lock across the READ and the WRITE, as create, delete and
        // move already do. The backend's `update_node` does take this mutex, so
        // the write alone was safe — but the read below it was not, and the gap
        // between them spans our own awaits. Two callers editing the same node
        // both read the original and both write: the first one's field silently
        // reverts. Worse, a delete landing in that gap is undone, because the
        // write re-inserts the node the other caller just removed.
        //
        // tokio's Mutex is not reentrant, so calling the backend's `update_node`
        // while holding the guard would deadlock. Mutate the map already held and
        // persist it with `save_nodes`.
        let _nodes_guard = self.backend_tx_manager.lock_nodes().await;
        let mut nodes = self.backend_tx_manager.get_all_nodes().await?;

        let mut node = nodes
            .get(node_id)
            .cloned()
            .ok_or_else(|| NetworkError::msg(format!("Node '{}' not found", node_id)))?;

        // Apply updates
        if let Some(new_name) = name {
            node.name = String::from(new_name);
        }
        if let Some(new_desc) = description {
            node.description = String::from(new_desc);
        }
        if let Some(new_mdx) = mdx_content {
            node.mdx_content = String::from(new_mdx);
            // Hashed HERE, where the content is stored, and nowhere else. The
            // client re-hashes before it executes the document and refuses on a
            // mismatch, so a document altered between this write and that
            // execution does not run. Computed from the value just assigned
            // rather than from `new_mdx`, so the two can never disagree.
            node.mdx_content_hash = Some(citadel_workspace_types::structs::mdx_content_hash(
                &node.mdx_content,
            ));
        }
        if let Some(new_rules) = rules {
            node.rules = Some(String::from(new_rules));
        }
        if let Some(new_chat_enabled) = chat_enabled {
            node.chat_enabled = new_chat_enabled;
            // Assign chat channel ID if enabling chat
            if new_chat_enabled && node.chat_channel_id.is_none() {
                node.chat_channel_id = Some(uuid::Uuid::new_v4().to_string());
            }
        }

        // Exactly one default, so setting it clears the others. Done inside the
        // same lock and the same save as the node's own change: a client that
        // saw one write succeed and the other fail would show two defaults, or
        // none, with no way to tell which.
        //
        // Only on `Some(true)` -- `Some(false)` clears this node's flag and
        // leaves the workspace with no default, which is a legitimate thing to
        // ask for and must not silently promote something else.
        if is_default == Some(true) {
            for (id, other) in nodes.iter_mut() {
                if id != node_id {
                    other.is_default = false;
                }
            }
        }
        if let Some(new_default) = is_default {
            node.is_default = new_default;
        }

        node.updated_at = current_timestamp();

        // Persist through the map we hold, not the backend mutator (see above).
        nodes.insert(String::from(node_id), node.clone());
        self.backend_tx_manager.save_nodes(&nodes).await?;

        Ok(node)
    }

    async fn delete_node(
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

        // Remove all deleted nodes
        for id in &deleted_ids {
            nodes.remove(id);
        }

        // Save updated nodes
        self.backend_tx_manager.save_nodes(&nodes).await?;

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
        // After the nodes are saved, not before: if this fails the tree is
        // already correct and the leftover keys are recoverable by deleting
        // again, whereas failing first would leave a room whose history is gone
        // but which is still listed and still writable.
        for channel_id in &deleted_channels {
            self.backend_tx_manager
                .delete_all_group_messages(channel_id)
                .await?;
        }

        Ok(deleted_ids)
    }

    async fn move_node(
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
            .ok_or_else(|| NetworkError::msg("Node disappeared after move"))
    }

    async fn list_nodes(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        depth: Option<u32>,
        entity_types: Option<&[NodeEntityType]>,
    ) -> Result<Vec<DomainNode>, NetworkError> {
        // Check if user is member of workspace
        if !self
            .is_member_of_domain(user_id, crate::WORKSPACE_ROOT_ID)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: Not a member of this workspace",
            ));
        }

        let nodes = self.backend_tx_manager.get_all_nodes().await?;
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

    async fn get_tree_structure(
        &self,
        user_id: &str,
        root_id: Option<&str>,
        max_depth: Option<u32>,
    ) -> Result<TreeNode, NetworkError> {
        // Check if user is member of workspace
        if !self
            .is_member_of_domain(user_id, crate::WORKSPACE_ROOT_ID)
            .await?
        {
            return Err(NetworkError::msg(
                "Permission denied: Not a member of this workspace",
            ));
        }

        let nodes = self.backend_tx_manager.get_all_nodes().await?;

        // Find the root node
        let root_node = if let Some(rid) = root_id {
            // Handle special case for workspace-root sentinel
            if rid == crate::WORKSPACE_ROOT_ID {
                // Return a synthetic workspace root node
                let workspace = self
                    .backend_tx_manager
                    .get_workspace(crate::WORKSPACE_ROOT_ID)
                    .await?;
                let (name, description, owner_id, members) = if let Some(ws) = workspace {
                    (
                        ws.name.clone(),
                        ws.description.clone(),
                        ws.owner_id.clone(),
                        ws.members.clone(),
                    )
                } else {
                    // Fallback for missing workspace
                    (
                        String::from(defaults::ROOT_NAME),
                        String::from(defaults::ROOT_DESC),
                        String::from(defaults::UNKNOWN_OWNER),
                        vec![],
                    )
                };

                // Get children - nodes whose parent is workspace-root
                let children: Vec<String> = nodes
                    .values()
                    .filter(|n| n.parent_id.as_deref() == Some(crate::WORKSPACE_ROOT_ID))
                    .map(|n| n.id.clone())
                    .collect();

                DomainNode {
                    id: String::from(crate::WORKSPACE_ROOT_ID),
                    parent_id: None,
                    entity_type: NodeEntityType::Workspace,
                    depth: 0,
                    name,
                    description,
                    owner_id,
                    members,
                    children,
                    mdx_content: String::new(),
                    mdx_content_hash: None,
                    rules: None,
                    chat_enabled: false,
                    chat_channel_id: None,
                    default_permissions: DomainPermissions::default(),
                    metadata: vec![],
                    allowed_child_types: None,
                    is_default: true,
                    created_at: 0,
                    updated_at: 0,
                }
            } else {
                nodes
                    .get(rid)
                    .ok_or_else(|| NetworkError::msg(format!("Root node '{}' not found", rid)))?
                    .clone()
            }
        } else {
            // No root_id specified - find workspace root node or create synthetic one
            nodes
                .values()
                .find(|n| n.parent_id.is_none())
                .cloned()
                .unwrap_or_else(|| {
                    // Create synthetic workspace root
                    let children: Vec<String> = nodes
                        .values()
                        .filter(|n| n.parent_id.as_deref() == Some(crate::WORKSPACE_ROOT_ID))
                        .map(|n| n.id.clone())
                        .collect();

                    DomainNode {
                        id: String::from(crate::WORKSPACE_ROOT_ID),
                        parent_id: None,
                        entity_type: NodeEntityType::Workspace,
                        depth: 0,
                        name: String::from(defaults::WORKSPACE_LABEL),
                        description: String::new(),
                        owner_id: String::new(),
                        members: vec![],
                        children,
                        mdx_content: String::new(),
                        mdx_content_hash: None,
                        rules: None,
                        chat_enabled: false,
                        chat_channel_id: None,
                        default_permissions: DomainPermissions::default(),
                        metadata: vec![],
                        allowed_child_types: None,
                        is_default: true,
                        created_at: 0,
                        updated_at: 0,
                    }
                })
        };

        Ok(build_tree(root_node, &nodes, max_depth))
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

/// Populate `allowed_child_types` from the tree schema for nodes that have `None`.
/// Ensures nodes created before schema enrichment was added still get correct values.
fn enrich_allowed_child_types(nodes: Vec<DomainNode>, schema: &TreeSchema) -> Vec<DomainNode> {
    nodes
        .into_iter()
        .map(|mut node| {
            if node.allowed_child_types.is_none() {
                node.allowed_child_types = schema
                    .rules
                    .iter()
                    .find(|r| r.parent_type == node.entity_type.type_name())
                    .map(|r| r.allowed_child_types.clone());
            }
            node
        })
        .collect()
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

#[cfg(test)]
mod build_tree_tests {
    use super::build_tree;
    use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
    use std::collections::HashMap;

    fn mk_node(id: &str, children: &[&str], depth: u32) -> DomainNode {
        DomainNode {
            id: id.to_string(),
            parent_id: None,
            entity_type: NodeEntityType::Child("Office".to_string()),
            depth,
            name: format!("node-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            children: children.iter().map(|s| s.to_string()).collect(),
            mdx_content: String::new(),
            mdx_content_hash: None,
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            metadata: vec![],
            allowed_child_types: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn arena(nodes: Vec<DomainNode>) -> HashMap<String, DomainNode> {
        nodes.into_iter().map(|n| (n.id.clone(), n)).collect()
    }

    #[test]
    fn root_only_has_no_children() {
        let root = mk_node("root", &[], 0);
        let nodes = arena(vec![root.clone()]);
        let tree = build_tree(root, &nodes, None);
        assert_eq!(tree.node.id, "root");
        assert!(tree.children.is_empty());
    }

    #[test]
    fn single_level_collects_direct_children() {
        let root = mk_node("root", &["a", "b"], 0);
        let nodes = arena(vec![
            root.clone(),
            mk_node("a", &[], 1),
            mk_node("b", &[], 1),
        ]);
        let tree = build_tree(root, &nodes, None);
        let mut ids: Vec<_> = tree.children.iter().map(|c| c.node.id.clone()).collect();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(tree.children.iter().all(|c| c.children.is_empty()));
    }

    #[test]
    fn max_depth_zero_returns_root_only() {
        let root = mk_node("root", &["a"], 0);
        let nodes = arena(vec![root.clone(), mk_node("a", &[], 1)]);
        let tree = build_tree(root, &nodes, Some(0));
        assert_eq!(tree.node.id, "root");
        assert!(tree.children.is_empty(), "Some(0) must not expand children");
    }

    #[test]
    fn max_depth_one_stops_below_direct_children() {
        let root = mk_node("root", &["a"], 0);
        let nodes = arena(vec![
            root.clone(),
            mk_node("a", &["g"], 1),
            mk_node("g", &[], 2),
        ]);
        let tree = build_tree(root, &nodes, Some(1));
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].node.id, "a");
        assert!(
            tree.children[0].children.is_empty(),
            "grandchild must be pruned at max_depth 1"
        );
    }

    #[test]
    fn unlimited_depth_builds_full_chain() {
        let root = mk_node("root", &["a"], 0);
        let nodes = arena(vec![
            root.clone(),
            mk_node("a", &["g"], 1),
            mk_node("g", &[], 2),
        ]);
        let tree = build_tree(root, &nodes, None);
        assert_eq!(tree.children[0].node.id, "a");
        assert_eq!(tree.children[0].children[0].node.id, "g");
    }

    #[test]
    fn missing_child_reference_is_skipped() {
        // root references "ghost", which isn't in the arena — it must be
        // ignored rather than panicking or inserting an empty node.
        let root = mk_node("root", &["ghost", "a"], 0);
        let nodes = arena(vec![root.clone(), mk_node("a", &[], 1)]);
        let tree = build_tree(root, &nodes, None);
        let ids: Vec<_> = tree.children.iter().map(|c| c.node.id.clone()).collect();
        assert_eq!(ids, vec!["a"]);
    }
}
