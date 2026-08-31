//! # The stored tree is validated at startup
//!
//! `TreeValidator::validate_tree` / `validate_tree_with_schema` existed with
//! zero callers, while the module doc said to run them "on startup and after
//! migrations" — every full-tree invariant (single root, no dangling parents,
//! no cycles, reachability) was enforced nowhere. It could not have been
//! wired as it stood: production persists NO root node (the workspace root is
//! a `Workspace` record, synthesized as a `DomainNode` on read), so the
//! validator returned NoRoot for every legitimate store.
//!
//! The fix models the implicit root and wires the check into `on_start`
//! through `validate_stored_tree`. These tests exercise that method — the
//! decision, not `on_start`'s call site, which only logs the Err (a corrupted
//! store must not crash-loop the one tool able to repair it).

use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
use common::workspace_test_utils::create_test_kernel;
use std::collections::HashMap;

fn node(id: &str, parent: &str, children: Vec<String>, depth: u32) -> DomainNode {
    node_of(id, parent, children, depth, "Office")
}

fn node_of(id: &str, parent: &str, children: Vec<String>, depth: u32, ty: &str) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: Some(parent.to_string()),
        entity_type: NodeEntityType::Child(ty.to_string()),
        depth,
        name: format!("node-{id}"),
        description: String::new(),
        owner_id: "nobody".to_string(),
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
        is_default: false,
        created_at: 0,
        updated_at: 0,
    }
}

/// The exact shape production persists must pass — this is what made the
/// validator unwireable before: it demanded a stored root and called every
/// real store rootless.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_persisted_production_shape_validates() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    // Empty store (fresh boot before seeding) is valid.
    kernel
        .validate_stored_tree()
        .await
        .expect("an empty tree is a fresh workspace, not corruption");

    // Offices hang off the implicit workspace root; rooms off offices.
    let mut nodes = HashMap::new();
    nodes.insert(
        "office1".to_string(),
        node("office1", WORKSPACE_ROOT_ID, vec!["room1".to_string()], 1),
    );
    nodes.insert(
        "room1".to_string(),
        node_of("room1", "office1", vec![], 2, "Room"),
    );
    backend.save_nodes(&nodes).await.expect("seed tree");

    kernel
        .validate_stored_tree()
        .await
        .expect("the production tree shape must validate at startup");
}

/// And a genuinely corrupted store must be reported.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_parent_ring_is_reported_as_corruption() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    // A valid top level, plus a 2-ring hanging beside it: B and C parent each
    // other. The ring is what request-time walkers would otherwise meet first.
    let mut nodes = HashMap::new();
    nodes.insert(
        "office1".to_string(),
        node("office1", WORKSPACE_ROOT_ID, vec![], 1),
    );
    nodes.insert("B".to_string(), node("B", "C", vec![], 2));
    nodes.insert("C".to_string(), node("C", "B", vec![], 2));
    backend.save_nodes(&nodes).await.expect("seed ring");

    let err = kernel
        .validate_stored_tree()
        .await
        .expect_err("a parent ring is corruption and must be reported");
    assert!(
        err.to_string().contains("integrity"),
        "the report names the check that failed: {err}"
    );
}
