//! # Node Operations Module
//!
//! This module provides async operations for the generalized tree hierarchy.
//! DomainNode entities represent arbitrary-depth nodes in the workspace tree.
//!
//! ## Architecture
//!
//! The NodeOperations trait defines CRUD operations for DomainNodes:
//! - CreateNode: Creates a new node under a parent
//! - GetNode: Retrieves a node by ID
//! - UpdateNode: Modifies node properties
//! - DeleteNode: Removes a node (optionally cascading to children)
//! - MoveNode: Relocates a node to a new parent
//! - ListNodes: Lists nodes with optional filtering
//! - GetTreeStructure: Returns nested tree starting from a node

use async_trait::async_trait;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{DomainNode, NodeEntityType, TreeNode};

/// Async operations for the generalized tree hierarchy
#[async_trait]
#[auto_impl::auto_impl(Arc)]
pub trait AsyncNodeOperations<R: Ratchet + Send + Sync + 'static>: Send + Sync {
    /// Create a new node in the workspace hierarchy tree.
    ///
    /// # Arguments
    /// * `user_id` - The user creating the node (must have EditTreeStructure permission)
    /// * `parent_id` - Parent node ID. None means create at workspace root level.
    /// * `entity_type` - Type of node (Workspace is only valid for root)
    /// * `name` - Node display name
    /// * `description` - Node description
    ///
    /// # Returns
    /// The created DomainNode with generated ID and timestamps
    async fn create_node(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        entity_type: &NodeEntityType,
        name: &str,
        description: &str,
    ) -> Result<DomainNode, NetworkError>;

    /// Get a specific node by ID.
    ///
    /// # Arguments
    /// * `user_id` - The user requesting the node (must be member of domain)
    /// * `node_id` - The unique node identifier
    ///
    /// # Returns
    /// The DomainNode if found and user has access
    async fn get_node(&self, user_id: &str, node_id: &str) -> Result<DomainNode, NetworkError>;

    /// Update an existing node's properties.
    ///
    /// # Arguments
    /// * `user_id` - The user updating the node (must have EditTreeStructure permission)
    /// * `node_id` - The node to update
    /// * `name` - New name (None to keep existing)
    /// * `description` - New description (None to keep existing)
    /// * `mdx_content` - New MDX content (None to keep existing)
    /// * `rules` - New rules text (None to keep existing)
    /// * `chat_enabled` - Whether chat is enabled (None to keep existing)
    ///
    /// # Returns
    /// The updated DomainNode
    #[allow(clippy::too_many_arguments)]
    async fn update_node(
        &self,
        user_id: &str,
        node_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
        rules: Option<&str>,
        chat_enabled: Option<bool>,
    ) -> Result<DomainNode, NetworkError>;

    /// Delete a node from the tree.
    ///
    /// # Arguments
    /// * `user_id` - The user deleting the node (must have EditTreeStructure permission)
    /// * `node_id` - The node to delete
    /// * `cascade` - If true, also delete all descendants; if false, fail if node has children
    ///
    /// # Returns
    /// Vec of deleted node IDs (includes descendants if cascade=true)
    async fn delete_node(
        &self,
        user_id: &str,
        node_id: &str,
        cascade: bool,
    ) -> Result<Vec<String>, NetworkError>;

    /// Move a node to a new parent.
    ///
    /// # Arguments
    /// * `user_id` - The user moving the node (must have EditTreeStructure permission)
    /// * `node_id` - The node to move
    /// * `new_parent_id` - New parent node ID. None moves to root level (not allowed for non-workspace).
    ///
    /// # Returns
    /// The updated DomainNode with new parent and depth
    async fn move_node(
        &self,
        user_id: &str,
        node_id: &str,
        new_parent_id: Option<&str>,
    ) -> Result<DomainNode, NetworkError>;

    /// List nodes with optional filtering.
    ///
    /// # Arguments
    /// * `user_id` - The user listing nodes (must be member of workspace)
    /// * `parent_id` - Parent to list children of. None lists from workspace root.
    /// * `depth` - How many levels deep to traverse beyond the start nodes:
    ///   * `Some(0)` - direct children only.
    ///   * `Some(n)` - the start nodes plus their descendants up to `n`
    ///     additional levels.
    ///   * `None` - **all descendants at every depth** (unlimited). This is the
    ///     intentional default used by the frontend so that newly-added rooms
    ///     (depth 2 under a workspace) are surfaced without a follow-up
    ///     request. The implementation has a visited-set guard so cycles or
    ///     duplicate child references cannot cause unbounded traversal.
    /// * `entity_types` - Filter to only these node types. None = all types.
    ///
    /// # Returns
    /// Vec of DomainNodes matching the filter criteria
    async fn list_nodes(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        depth: Option<u32>,
        entity_types: Option<&[NodeEntityType]>,
    ) -> Result<Vec<DomainNode>, NetworkError>;

    /// Get the full tree structure starting from a node.
    ///
    /// # Arguments
    /// * `user_id` - The user requesting the tree (must be member of workspace)
    /// * `root_id` - Node to start from. None starts from workspace root.
    /// * `max_depth` - Maximum depth to traverse. None = unlimited.
    ///
    /// # Returns
    /// TreeNode with nested children structure
    async fn get_tree_structure(
        &self,
        user_id: &str,
        root_id: Option<&str>,
        max_depth: Option<u32>,
    ) -> Result<TreeNode, NetworkError>;
}
