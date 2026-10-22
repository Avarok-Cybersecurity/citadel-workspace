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
