//! # Tree Validator Module
//!
//! This module provides validation utilities for the workspace hierarchy tree.
//! It ensures tree integrity by checking for:
//! - Single root node (workspace)
//! - No dangling parent references
//! - No cycles in the hierarchy
//! - All nodes reachable from root (no orphan subtrees)
//! - Schema compliance (depth limits, valid child types)
//!
//! ## Usage
//!
//! ```rust,ignore
//! use citadel_workspace_server_kernel::handlers::domain::tree_validator::{TreeValidator, NodeMutation};
//!
//! // Validate entire tree on startup
//! TreeValidator::validate_tree(&nodes)?;
//!
//! // Validate a mutation before applying
//! TreeValidator::validate_mutation(&nodes, &mutation)?;
//! ```

use citadel_workspace_types::structs::{DomainNode, TreeSchema};
use std::collections::{HashMap, HashSet, VecDeque};

/// Placeholder node ID used in error messages for nodes not yet created
const NEW_NODE_PLACEHOLDER: &str = "new_node";

// ═══════════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════════════

/// Errors that can occur during tree validation
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TreeValidationError {
    /// A node references a parent that does not exist
    DanglingNode {
        node_id: String,
        invalid_parent_id: String,
    },
    /// A cycle was detected in the tree (node appears in its own ancestor chain)
    CycleDetected {
        node_id: String,
        ancestor_id: String,
    },
    /// Multiple root nodes found (only one node should have parent_id=None)
    MultipleRoots { root_ids: Vec<String> },
    /// No root node found (tree must have exactly one root)
    NoRoot,
    /// Some nodes are not reachable from the root
    OrphanSubtree { disconnected_node_ids: Vec<String> },
    /// A node exceeds the maximum allowed depth from schema
    DepthExceedsSchema {
        node_id: String,
        depth: u32,
        max_depth: u32,
    },
    /// A child type is not allowed under the given parent type
    InvalidChildType {
        parent_type: String,
        child_type: String,
    },
    /// Parent node not found for mutation
    ParentNotFound { parent_id: String },
    /// Node not found for mutation
    NodeNotFound { node_id: String },
    /// Cannot delete root node
    CannotDeleteRoot { node_id: String },
    /// Cannot move node to be its own descendant (would create cycle)
    WouldCreateCycle {
        node_id: String,
        new_parent_id: String,
    },
}

impl std::fmt::Display for TreeValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TreeValidationError::DanglingNode {
                node_id,
                invalid_parent_id,
            } => {
                write!(
                    f,
                    "Node '{}' references non-existent parent '{}'",
                    node_id, invalid_parent_id
                )
            }
            TreeValidationError::CycleDetected {
                node_id,
                ancestor_id,
            } => {
                write!(
                    f,
                    "Cycle detected: node '{}' has '{}' in its ancestor chain",
                    node_id, ancestor_id
                )
            }
            TreeValidationError::MultipleRoots { root_ids } => {
                write!(f, "Multiple root nodes found: {:?}", root_ids)
            }
            TreeValidationError::NoRoot => {
                write!(
                    f,
                    "No root node found (must have exactly one workspace root)"
                )
            }
            TreeValidationError::OrphanSubtree {
                disconnected_node_ids,
            } => {
                write!(
                    f,
                    "Orphan subtree detected with nodes: {:?}",
                    disconnected_node_ids
                )
            }
            TreeValidationError::DepthExceedsSchema {
                node_id,
                depth,
                max_depth,
            } => {
                write!(
                    f,
                    "Node '{}' at depth {} exceeds max depth {}",
                    node_id, depth, max_depth
                )
            }
            TreeValidationError::InvalidChildType {
                parent_type,
                child_type,
            } => {
                write!(
                    f,
                    "Child type '{}' not allowed under parent type '{}'",
                    child_type, parent_type
                )
            }
            TreeValidationError::ParentNotFound { parent_id } => {
                write!(f, "Parent node '{}' not found", parent_id)
            }
            TreeValidationError::NodeNotFound { node_id } => {
                write!(f, "Node '{}' not found", node_id)
            }
            TreeValidationError::CannotDeleteRoot { node_id } => {
                write!(f, "Cannot delete root node '{}'", node_id)
            }
            TreeValidationError::WouldCreateCycle {
                node_id,
                new_parent_id,
            } => {
                write!(
                    f,
                    "Moving node '{}' under '{}' would create a cycle",
                    node_id, new_parent_id
                )
            }
        }
    }
}

impl std::error::Error for TreeValidationError {}

// ═══════════════════════════════════════════════════════════════════════════════════
// MUTATION TYPES
// ═══════════════════════════════════════════════════════════════════════════════════

/// Represents a mutation to the tree structure
#[derive(Debug, Clone)]
pub enum NodeMutation {
    /// Create a new node under a parent
    Create {
        node_id: String,
        parent_id: Option<String>,
        node_type: String,
        depth: u32,
    },
    /// Move a node to a new parent
    Move {
        node_id: String,
        new_parent_id: String,
    },
    /// Delete a node (and its subtree)
    Delete { node_id: String },
    /// Update a node's type (rare, requires revalidation)
    UpdateType { node_id: String, new_type: String },
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TREE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════════════

/// Validates tree integrity for workspace hierarchy
pub struct TreeValidator;

impl TreeValidator {
    // ═══════════════════════════════════════════════════════════════════════════════
    // FULL TREE VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Validate entire tree integrity - call on startup and after migrations
    ///
    /// Performs all validation checks:
    /// 1. Single root check
    /// 2. No dangling parent references
    /// 3. No cycles
    /// 4. All nodes reachable from root
    ///
    /// # Arguments
    /// * `nodes` - HashMap of all nodes keyed by node ID
    ///
    /// # Returns
    /// * `Ok(())` - Tree is valid
    /// * `Err(TreeValidationError)` - First validation error encountered
    pub fn validate_tree(nodes: &HashMap<String, DomainNode>) -> Result<(), TreeValidationError> {
        // Empty tree is valid (no workspace created yet)
        if nodes.is_empty() {
            return Ok(());
        }

        // Check 1: Single root
        Self::check_single_root(nodes)?;

        // Check 2: No dangling parents
        Self::check_no_dangling_parents(nodes)?;

        // Check 3: No cycles
        Self::check_no_cycles(nodes)?;

        // Check 4: All nodes reachable from root
        Self::check_all_reachable_from_root(nodes)?;

        Ok(())
    }

    /// Validate tree with schema constraints
    ///
    /// Adds schema validation on top of structural validation:
    /// - Maximum depth constraints
    /// - Valid parent-child type relationships
    pub fn validate_tree_with_schema(
        nodes: &HashMap<String, DomainNode>,
        schema: &TreeSchema,
    ) -> Result<(), TreeValidationError> {
        // First, validate structural integrity
        Self::validate_tree(nodes)?;

        // First, check depth constraints for all nodes
        // (this catches depth violations early, regardless of type rules)
        if let Some(max_depth) = schema.max_depth {
            for node in nodes.values() {
                if node.depth > max_depth {
                    return Err(TreeValidationError::DepthExceedsSchema {
                        node_id: node.id.clone(),
                        depth: node.depth,
                        max_depth,
                    });
                }
            }
        }

        // Then check parent-child type relationships
        // (only if schema has rules defined)
        if !schema.rules.is_empty() {
            for node in nodes.values() {
                if let Some(parent_id) = &node.parent_id {
                    if let Some(parent) = nodes.get(parent_id) {
                        let parent_type = parent.entity_type.type_name();
                        let child_type = node.entity_type.type_name();

                        if !schema.is_child_allowed(parent_type, child_type) {
                            return Err(TreeValidationError::InvalidChildType {
                                parent_type: parent_type.to_string(),
                                child_type: child_type.to_string(),
                            });
                        }
                    }
                }
            }
        }

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MUTATION VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Validate a single mutation before applying
    ///
    /// This is more efficient than validating the entire tree after mutation.
    /// It checks only the constraints relevant to the specific mutation type.
    pub fn validate_mutation(
        nodes: &HashMap<String, DomainNode>,
        mutation: &NodeMutation,
    ) -> Result<(), TreeValidationError> {
        match mutation {
            NodeMutation::Create {
                node_id,
                parent_id,
                node_type: _,
                depth: _,
            } => Self::validate_create(nodes, node_id, parent_id.as_deref()),

            NodeMutation::Move {
                node_id,
                new_parent_id,
            } => Self::validate_move(nodes, node_id, new_parent_id),

            NodeMutation::Delete { node_id } => Self::validate_delete(nodes, node_id),

            NodeMutation::UpdateType {
                node_id,
                new_type: _,
            } => {
                // Just verify node exists; type validation needs schema context
                if !nodes.contains_key(node_id) {
                    return Err(TreeValidationError::NodeNotFound {
                        node_id: node_id.clone(),
                    });
                }
                Ok(())
            }
        }
    }

    /// Validate mutation with schema constraints
    pub fn validate_mutation_with_schema(
        nodes: &HashMap<String, DomainNode>,
        mutation: &NodeMutation,
        schema: &TreeSchema,
    ) -> Result<(), TreeValidationError> {
        // First, validate structural constraints
        Self::validate_mutation(nodes, mutation)?;

        // Then validate schema-specific constraints
        match mutation {
            NodeMutation::Create {
                parent_id,
                node_type,
                depth,
                ..
            } => {
                // Check depth limit
                if let Some(max_depth) = schema.max_depth {
                    if *depth > max_depth {
                        return Err(TreeValidationError::DepthExceedsSchema {
                            node_id: NEW_NODE_PLACEHOLDER.to_string(),
                            depth: *depth,
                            max_depth,
                        });
                    }
                }

                // Check parent-child type relationship
                if let Some(parent_id) = parent_id {
                    // Special case: workspace-root is treated as type "Workspace"
                    let parent_type = if parent_id == crate::WORKSPACE_ROOT_ID {
                        "Workspace"
                    } else if let Some(parent) = nodes.get(parent_id) {
                        parent.entity_type.type_name()
                    } else {
                        // Parent not found - validation already done in validate_mutation
                        return Ok(());
                    };

                    if !schema.is_child_allowed(parent_type, node_type) {
                        return Err(TreeValidationError::InvalidChildType {
                            parent_type: parent_type.to_string(),
                            child_type: node_type.clone(),
                        });
                    }
                }
            }

            NodeMutation::Move {
                node_id,
                new_parent_id,
            } => {
                // Get the node being moved (required)
                let node = match nodes.get(node_id) {
                    Some(n) => n,
                    None => return Ok(()), // Node not found - validated elsewhere
                };

                // Determine parent type and new depth
                // Special case: workspace-root is treated as type "Workspace" at depth 0
                let is_workspace_root = new_parent_id == crate::WORKSPACE_ROOT_ID;
                let (parent_type, parent_depth): (&str, u32) = if is_workspace_root {
                    ("Workspace", 0)
                } else if let Some(new_parent) = nodes.get(new_parent_id) {
                    (new_parent.entity_type.type_name(), new_parent.depth)
                } else {
                    return Ok(()); // Parent not found - validated elsewhere
                };

                let child_type = node.entity_type.type_name();

                if !schema.is_child_allowed(parent_type, child_type) {
                    return Err(TreeValidationError::InvalidChildType {
                        parent_type: parent_type.to_string(),
                        child_type: child_type.to_string(),
                    });
                }

                // Check depth constraint after move
                let new_depth = parent_depth + 1;
                if let Some(max_depth) = schema.max_depth {
                    // Also need to check subtree depths
                    let subtree_max_depth = Self::get_subtree_max_depth(nodes, node_id);
                    let depth_increase = new_depth.saturating_sub(node.depth);
                    let new_subtree_max = subtree_max_depth + depth_increase;

                    if new_subtree_max > max_depth {
                        return Err(TreeValidationError::DepthExceedsSchema {
                            node_id: node_id.clone(),
                            depth: new_subtree_max,
                            max_depth,
                        });
                    }
                }
            }

            _ => {} // Other mutations don't have schema-specific constraints
        }

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // INDIVIDUAL VALIDATION CHECKS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Check that exactly one root node exists (parent_id = None)
    fn check_single_root(nodes: &HashMap<String, DomainNode>) -> Result<(), TreeValidationError> {
        let roots: Vec<String> = nodes
            .values()
            .filter(|n| n.parent_id.is_none())
            .map(|n| n.id.clone())
            .collect();

        match roots.len() {
            0 => Err(TreeValidationError::NoRoot),
            1 => Ok(()),
            _ => Err(TreeValidationError::MultipleRoots { root_ids: roots }),
        }
    }

    /// Check that all parent_ids reference existing nodes
    fn check_no_dangling_parents(
        nodes: &HashMap<String, DomainNode>,
    ) -> Result<(), TreeValidationError> {
        for node in nodes.values() {
            if let Some(parent_id) = &node.parent_id {
                if !nodes.contains_key(parent_id) {
                    return Err(TreeValidationError::DanglingNode {
                        node_id: node.id.clone(),
                        invalid_parent_id: parent_id.clone(),
                    });
                }
            }
        }
        Ok(())
    }

    /// Check that no node appears in its own ancestor chain
    fn check_no_cycles(nodes: &HashMap<String, DomainNode>) -> Result<(), TreeValidationError> {
        for node in nodes.values() {
            let mut visited = HashSet::new();
            visited.insert(node.id.as_str());

            let mut current_id = node.parent_id.as_deref();
            while let Some(parent_id) = current_id {
                if visited.contains(parent_id) {
                    return Err(TreeValidationError::CycleDetected {
                        node_id: node.id.clone(),
                        ancestor_id: parent_id.to_string(),
                    });
                }
                visited.insert(parent_id);

                current_id = nodes.get(parent_id).and_then(|n| n.parent_id.as_deref());
            }
        }
        Ok(())
    }

    /// Check that all nodes are reachable from the root via BFS
    fn check_all_reachable_from_root(
        nodes: &HashMap<String, DomainNode>,
    ) -> Result<(), TreeValidationError> {
        if nodes.is_empty() {
            return Ok(());
        }

        // Find root
        let root = nodes
            .values()
            .find(|n| n.parent_id.is_none())
            .ok_or(TreeValidationError::NoRoot)?;

        // BFS from root using &str to avoid allocations
        let mut visited: HashSet<&str> = HashSet::new();
        let mut queue: VecDeque<&str> = VecDeque::new();
        queue.push_back(root.id.as_str());

        while let Some(current_id) = queue.pop_front() {
            if visited.contains(current_id) {
                continue;
            }
            visited.insert(current_id);

            // Add children to queue
            if let Some(node) = nodes.get(current_id) {
                for child_id in &node.children {
                    if !visited.contains(child_id.as_str()) {
                        queue.push_back(child_id.as_str());
                    }
                }
            }
        }

        // Check if all nodes were visited (only allocate on error path)
        let disconnected: Vec<String> = nodes
            .keys()
            .filter(|id| !visited.contains(id.as_str()))
            .cloned()
            .collect();

        if disconnected.is_empty() {
            Ok(())
        } else {
            Err(TreeValidationError::OrphanSubtree {
                disconnected_node_ids: disconnected,
            })
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MUTATION-SPECIFIC VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Validate a create mutation
    fn validate_create(
        nodes: &HashMap<String, DomainNode>,
        _node_id: &str,
        parent_id: Option<&str>,
    ) -> Result<(), TreeValidationError> {
        // If parent is specified, it must exist (or be a workspace root)
        if let Some(parent_id) = parent_id {
            // Special cases where parent is valid without being in DomainNode storage:
            // 1. WORKSPACE_ROOT_ID ("workspace-root") - single workspace mode
            // 2. UUID format - workspace ID for multi-workspace mode (validated by caller)
            let is_workspace_root = parent_id == crate::WORKSPACE_ROOT_ID;
            let is_uuid = Self::is_valid_uuid(parent_id);

            if !is_workspace_root && !is_uuid && !nodes.contains_key(parent_id) {
                return Err(TreeValidationError::ParentNotFound {
                    parent_id: parent_id.to_string(),
                });
            }
        } else {
            // Creating a root - must be the first node
            if !nodes.is_empty() {
                let existing_roots: Vec<String> = nodes
                    .values()
                    .filter(|n| n.parent_id.is_none())
                    .map(|n| n.id.clone())
                    .collect();

                if !existing_roots.is_empty() {
                    return Err(TreeValidationError::MultipleRoots {
                        root_ids: existing_roots,
                    });
                }
            }
        }
        Ok(())
    }

    /// Check if a string is a valid UUID v4 format
    fn is_valid_uuid(s: &str) -> bool {
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        // where x is any hex digit and y is 8, 9, a, or b
        if s.len() != 36 {
            return false;
        }
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() != 5 {
            return false;
        }
        // Check length of each part: 8-4-4-4-12
        if parts[0].len() != 8
            || parts[1].len() != 4
            || parts[2].len() != 4
            || parts[3].len() != 4
            || parts[4].len() != 12
        {
            return false;
        }
        // Check all parts are hex
        parts
            .iter()
            .all(|p| p.chars().all(|c| c.is_ascii_hexdigit()))
    }

    /// Validate a move mutation
    fn validate_move(
        nodes: &HashMap<String, DomainNode>,
        node_id: &str,
        new_parent_id: &str,
    ) -> Result<(), TreeValidationError> {
        // Node must exist
        if !nodes.contains_key(node_id) {
            return Err(TreeValidationError::NodeNotFound {
                node_id: node_id.to_string(),
            });
        }

        // New parent must exist (or be workspace-root sentinel)
        let is_workspace_root = new_parent_id == crate::WORKSPACE_ROOT_ID;
        if !is_workspace_root && !nodes.contains_key(new_parent_id) {
            return Err(TreeValidationError::ParentNotFound {
                parent_id: new_parent_id.to_string(),
            });
        }

        // Cannot move to self
        if node_id == new_parent_id {
            return Err(TreeValidationError::WouldCreateCycle {
                node_id: node_id.to_string(),
                new_parent_id: new_parent_id.to_string(),
            });
        }

        // Cannot move to a descendant (would create cycle)
        // Skip this check for workspace-root since it cannot be a descendant of any node
        if !is_workspace_root && Self::is_ancestor_of(nodes, node_id, new_parent_id) {
            return Err(TreeValidationError::WouldCreateCycle {
                node_id: node_id.to_string(),
                new_parent_id: new_parent_id.to_string(),
            });
        }

        Ok(())
    }

    /// Validate a delete mutation
    fn validate_delete(
        nodes: &HashMap<String, DomainNode>,
        node_id: &str,
    ) -> Result<(), TreeValidationError> {
        let node = nodes
            .get(node_id)
            .ok_or_else(|| TreeValidationError::NodeNotFound {
                node_id: node_id.to_string(),
            })?;

        // Cannot delete root
        if node.parent_id.is_none() {
            return Err(TreeValidationError::CannotDeleteRoot {
                node_id: node_id.to_string(),
            });
        }

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Check if `potential_ancestor` is an ancestor of `node_id`
    fn is_ancestor_of(
        nodes: &HashMap<String, DomainNode>,
        potential_ancestor: &str,
        node_id: &str,
    ) -> bool {
        let mut current_id: Option<&str> = Some(node_id);

        while let Some(id) = current_id {
            if id == potential_ancestor {
                return true;
            }
            current_id = nodes.get(id).and_then(|n| n.parent_id.as_deref());
        }

        false
    }

    /// Get the maximum depth in the subtree rooted at `node_id`
    fn get_subtree_max_depth(nodes: &HashMap<String, DomainNode>, node_id: &str) -> u32 {
        let node = match nodes.get(node_id) {
            Some(n) => n,
            None => return 0,
        };

        let mut max_depth = node.depth;
        let mut queue: VecDeque<&str> = VecDeque::new();
        queue.push_back(node_id);

        while let Some(current_id) = queue.pop_front() {
            if let Some(current) = nodes.get(current_id) {
                max_depth = max_depth.max(current.depth);
                for child_id in &current.children {
                    queue.push_back(child_id.as_str());
                }
            }
        }

        max_depth
    }

    /// Get the path from root to a node (for debugging/display)
    pub fn get_path_to_root(nodes: &HashMap<String, DomainNode>, node_id: &str) -> Vec<String> {
        let mut path: Vec<&str> = Vec::new();
        let mut current_id: Option<&str> = Some(node_id);

        while let Some(id) = current_id {
            path.push(id);
            current_id = nodes.get(id).and_then(|n| n.parent_id.as_deref());
        }

        path.reverse();
        path.into_iter().map(String::from).collect()
    }

    /// Get all descendants of a node (for cascade operations)
    pub fn get_descendants(nodes: &HashMap<String, DomainNode>, node_id: &str) -> Vec<String> {
        let mut seen: HashSet<&str> = HashSet::new();
        let mut result = Vec::new();
        let mut queue: VecDeque<&str> = VecDeque::new();

        if let Some(node) = nodes.get(node_id) {
            for child_id in &node.children {
                queue.push_back(child_id.as_str());
            }
        }

        while let Some(current_id) = queue.pop_front() {
            if seen.insert(current_id) {
                result.push(current_id.to_string());
                if let Some(node) = nodes.get(current_id) {
                    for child_id in &node.children {
                        queue.push_back(child_id.as_str());
                    }
                }
            }
        }

        result
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_workspace_types::structs::{DomainPermissions, NodeEntityType};

    fn create_test_node(
        id: &str,
        parent_id: Option<&str>,
        entity_type: NodeEntityType,
        depth: u32,
    ) -> DomainNode {
        DomainNode {
            id: id.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            entity_type,
            depth,
            name: format!("Test {}", id),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            children: vec![],
            mdx_content: String::new(),
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

    #[test]
    fn test_empty_tree_is_valid() {
        let nodes = HashMap::new();
        assert!(TreeValidator::validate_tree(&nodes).is_ok());
    }

    #[test]
    fn test_single_root_is_valid() {
        let mut nodes = HashMap::new();
        nodes.insert(
            "ws1".to_string(),
            create_test_node("ws1", None, NodeEntityType::Workspace, 0),
        );
        assert!(TreeValidator::validate_tree(&nodes).is_ok());
    }

    #[test]
    fn test_multiple_roots_error() {
        let mut nodes = HashMap::new();
        nodes.insert(
            "ws1".to_string(),
            create_test_node("ws1", None, NodeEntityType::Workspace, 0),
        );
        nodes.insert(
            "ws2".to_string(),
            create_test_node("ws2", None, NodeEntityType::Workspace, 0),
        );

        let result = TreeValidator::validate_tree(&nodes);
        assert!(matches!(
            result,
            Err(TreeValidationError::MultipleRoots { .. })
        ));
    }

    #[test]
    fn test_dangling_parent_error() {
        let mut nodes = HashMap::new();
        nodes.insert(
            "ws1".to_string(),
            create_test_node("ws1", None, NodeEntityType::Workspace, 0),
        );
        nodes.insert(
            "office1".to_string(),
            create_test_node(
                "office1",
                Some("nonexistent"),
                NodeEntityType::Child("Office".to_string()),
                1,
            ),
        );

        let result = TreeValidator::validate_tree(&nodes);
        assert!(matches!(
            result,
            Err(TreeValidationError::DanglingNode { .. })
        ));
    }

    #[test]
    fn test_valid_two_level_tree() {
        let mut nodes = HashMap::new();

        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string()];
        nodes.insert("ws1".to_string(), ws);

        nodes.insert(
            "office1".to_string(),
            create_test_node(
                "office1",
                Some("ws1"),
                NodeEntityType::Child("Office".to_string()),
                1,
            ),
        );

        assert!(TreeValidator::validate_tree(&nodes).is_ok());
    }

    #[test]
    fn test_orphan_subtree_error() {
        let mut nodes = HashMap::new();

        // Root with one child
        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string()];
        nodes.insert("ws1".to_string(), ws);

        nodes.insert(
            "office1".to_string(),
            create_test_node(
                "office1",
                Some("ws1"),
                NodeEntityType::Child("Office".to_string()),
                1,
            ),
        );

        // Orphan subtree (parent exists but not in children list)
        let mut orphan_parent = create_test_node(
            "orphan_office",
            Some("ws1"),
            NodeEntityType::Child("Office".to_string()),
            1,
        );
        orphan_parent.children = vec!["orphan_room".to_string()];
        nodes.insert("orphan_office".to_string(), orphan_parent);

        nodes.insert(
            "orphan_room".to_string(),
            create_test_node(
                "orphan_room",
                Some("orphan_office"),
                NodeEntityType::Child("Room".to_string()),
                2,
            ),
        );

        let result = TreeValidator::validate_tree(&nodes);
        assert!(matches!(
            result,
            Err(TreeValidationError::OrphanSubtree { .. })
        ));
    }

    #[test]
    fn test_move_to_descendant_error() {
        let mut nodes = HashMap::new();

        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string()];
        nodes.insert("ws1".to_string(), ws);

        let mut office = create_test_node(
            "office1",
            Some("ws1"),
            NodeEntityType::Child("Office".to_string()),
            1,
        );
        office.children = vec!["room1".to_string()];
        nodes.insert("office1".to_string(), office);

        nodes.insert(
            "room1".to_string(),
            create_test_node(
                "room1",
                Some("office1"),
                NodeEntityType::Child("Room".to_string()),
                2,
            ),
        );

        // Try to move office1 under room1 (its descendant)
        let mutation = NodeMutation::Move {
            node_id: "office1".to_string(),
            new_parent_id: "room1".to_string(),
        };

        let result = TreeValidator::validate_mutation(&nodes, &mutation);
        assert!(matches!(
            result,
            Err(TreeValidationError::WouldCreateCycle { .. })
        ));
    }

    #[test]
    fn test_delete_root_error() {
        let mut nodes = HashMap::new();
        nodes.insert(
            "ws1".to_string(),
            create_test_node("ws1", None, NodeEntityType::Workspace, 0),
        );

        let mutation = NodeMutation::Delete {
            node_id: "ws1".to_string(),
        };

        let result = TreeValidator::validate_mutation(&nodes, &mutation);
        assert!(matches!(
            result,
            Err(TreeValidationError::CannotDeleteRoot { .. })
        ));
    }

    #[test]
    fn test_schema_depth_validation() {
        let mut nodes = HashMap::new();

        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string()];
        nodes.insert("ws1".to_string(), ws);

        let mut office = create_test_node(
            "office1",
            Some("ws1"),
            NodeEntityType::Child("Office".to_string()),
            1,
        );
        office.children = vec!["room1".to_string()];
        nodes.insert("office1".to_string(), office);

        let mut room = create_test_node(
            "room1",
            Some("office1"),
            NodeEntityType::Child("Room".to_string()),
            2,
        );
        room.children = vec!["deep1".to_string()];
        nodes.insert("room1".to_string(), room);

        // This node exceeds max_depth of 2
        nodes.insert(
            "deep1".to_string(),
            create_test_node(
                "deep1",
                Some("room1"),
                NodeEntityType::Child("Deep".to_string()),
                3,
            ),
        );

        let schema = TreeSchema {
            id: "test".to_string(),
            name: "Test Schema".to_string(),
            rules: vec![],
            max_depth: Some(2),
            entity_type_configs: vec![],
        };

        let result = TreeValidator::validate_tree_with_schema(&nodes, &schema);
        assert!(matches!(
            result,
            Err(TreeValidationError::DepthExceedsSchema { .. })
        ));
    }

    #[test]
    fn test_get_descendants() {
        let mut nodes = HashMap::new();

        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string(), "office2".to_string()];
        nodes.insert("ws1".to_string(), ws);

        let mut office1 = create_test_node(
            "office1",
            Some("ws1"),
            NodeEntityType::Child("Office".to_string()),
            1,
        );
        office1.children = vec!["room1".to_string()];
        nodes.insert("office1".to_string(), office1);

        nodes.insert(
            "office2".to_string(),
            create_test_node(
                "office2",
                Some("ws1"),
                NodeEntityType::Child("Office".to_string()),
                1,
            ),
        );

        nodes.insert(
            "room1".to_string(),
            create_test_node(
                "room1",
                Some("office1"),
                NodeEntityType::Child("Room".to_string()),
                2,
            ),
        );

        let descendants = TreeValidator::get_descendants(&nodes, "ws1");
        assert_eq!(descendants.len(), 3);
        assert!(descendants.iter().any(|s| s == "office1"));
        assert!(descendants.iter().any(|s| s == "office2"));
        assert!(descendants.iter().any(|s| s == "room1"));
    }

    #[test]
    fn test_get_path_to_root() {
        let mut nodes = HashMap::new();

        let mut ws = create_test_node("ws1", None, NodeEntityType::Workspace, 0);
        ws.children = vec!["office1".to_string()];
        nodes.insert("ws1".to_string(), ws);

        let mut office = create_test_node(
            "office1",
            Some("ws1"),
            NodeEntityType::Child("Office".to_string()),
            1,
        );
        office.children = vec!["room1".to_string()];
        nodes.insert("office1".to_string(), office);

        nodes.insert(
            "room1".to_string(),
            create_test_node(
                "room1",
                Some("office1"),
                NodeEntityType::Child("Room".to_string()),
                2,
            ),
        );

        let path = TreeValidator::get_path_to_root(&nodes, "room1");
        assert_eq!(path, vec!["ws1", "office1", "room1"]);
    }
}
