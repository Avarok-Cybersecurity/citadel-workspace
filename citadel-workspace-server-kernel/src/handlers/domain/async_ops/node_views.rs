//! What a node read reports, as distinct from what is stored.
//!
//! `allowed_child_types` is derived from the LIVE tree schema on every read. Nodes used to keep
//! the list their schema had when they were created, so a widened schema never reached a node
//! that already existed; whatever a node has stored in that field is now ignored.
//!
//! The workspace root is a `Workspace` record, never a stored node, so reads synthesise it.

use citadel_workspace_types::structs::{
    DomainNode, DomainPermissions, NodeEntityType, TreeNode, TreeSchema, Workspace,
};
use std::collections::HashMap;

/// Values a synthesised root takes when no workspace record names them.
mod defaults {
    pub const ROOT_NAME: &str = crate::DEFAULT_ROOT_WORKSPACE_NAME;
    pub const ROOT_DESC: &str = "Root workspace";
    pub const UNKNOWN_OWNER: &str = "unknown";
    pub const WORKSPACE_LABEL: &str = "Workspace";
}

/// Set `node`'s child types to those the live schema allows under its type.
fn set_live_child_types(node: &mut DomainNode, schema: &TreeSchema) {
    node.allowed_child_types = schema
        .rules
        .iter()
        .find(|r| r.parent_type == node.entity_type.type_name())
        .map(|r| r.allowed_child_types.clone());
}

pub(super) fn with_live_child_types(mut node: DomainNode, schema: &TreeSchema) -> DomainNode {
    set_live_child_types(&mut node, schema);
    node
}

pub(super) fn enrich_allowed_child_types(
    nodes: Vec<DomainNode>,
    schema: &TreeSchema,
) -> Vec<DomainNode> {
    nodes
        .into_iter()
        .map(|node| with_live_child_types(node, schema))
        .collect()
}

/// Every node in `tree`, walked with an explicit stack: a tree may be arbitrarily deep.
pub(super) fn enrich_tree(mut tree: TreeNode, schema: &TreeSchema) -> TreeNode {
    let mut stack = vec![&mut tree];
    while let Some(current) = stack.pop() {
        set_live_child_types(&mut current.node, schema);
        stack.extend(current.children.iter_mut());
    }
    tree
}

/// The ids of the nodes directly under the workspace root.
fn root_children(nodes: &HashMap<String, DomainNode>) -> Vec<String> {
    nodes
        .values()
        .filter(|n| n.parent_id.as_deref() == Some(crate::WORKSPACE_ROOT_ID))
        .map(|n| n.id.clone())
        .collect()
}

fn root_node(
    name: String,
    description: String,
    owner_id: String,
    members: Vec<String>,
    children: Vec<String>,
) -> DomainNode {
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
}

/// The root as its workspace record describes it.
pub(super) fn workspace_root(
    workspace: Option<Workspace>,
    nodes: &HashMap<String, DomainNode>,
) -> DomainNode {
    match workspace {
        Some(ws) => root_node(
            ws.name,
            ws.description,
            ws.owner_id,
            ws.members,
            root_children(nodes),
        ),
        None => root_node(
            String::from(defaults::ROOT_NAME),
            String::from(defaults::ROOT_DESC),
            String::from(defaults::UNKNOWN_OWNER),
            vec![],
            root_children(nodes),
        ),
    }
}

/// The root of a store that holds no root node and was not asked for one by id.
pub(super) fn unnamed_root(nodes: &HashMap<String, DomainNode>) -> DomainNode {
    root_node(
        String::from(defaults::WORKSPACE_LABEL),
        String::new(),
        String::new(),
        vec![],
        root_children(nodes),
    )
}
