//! # BFS Cycle/Duplicate Protection Test for `list_nodes`
//!
//! The `list_nodes` handler walks the DomainNode tree via BFS. With
//! `depth = None` (unlimited), a cycle in `children` references - or merely a
//! duplicate child reference under two parents - would cause the BFS loop to
//! iterate forever, growing the result set unboundedly and eventually OOMing
//! the server.
//!
//! A cycle is not something the happy-path code paths produce, but it can
//! arise from:
//!   * a future mutation bug,
//!   * a manual backend edit,
//!   * storage corruption,
//!   * or cross-parent duplicate children.
//!
//! This test exercises the cycle guard directly by planting a 3-cycle in the
//! `children` field and calling `list_nodes` with `depth = None`. It must
//! return in bounded time with a bounded result set.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

/// Helper to build a minimally-valid DomainNode for test injection.
fn mk_node(id: &str, parent: Option<&str>, children: Vec<String>, depth: u32) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: parent.map(|s| s.to_string()),
        entity_type: NodeEntityType::Child("Office".to_string()),
        depth,
        name: format!("node-{id}"),
        description: String::new(),
        owner_id: TEST_ADMIN_USER_ID.to_string(),
        members: vec![],
        children,
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

/// Build a 3-cycle A -> B -> C -> A directly under the workspace root.
/// Without the cycle guard, a BFS with unlimited depth from the root would
/// walk this ring forever.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_nodes_terminates_on_cycle() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "A".to_string(),
        mk_node("A", Some(WORKSPACE_ROOT_ID), vec!["B".to_string()], 1),
    );
    nodes.insert(
        "B".to_string(),
        mk_node("B", Some("A"), vec!["C".to_string()], 2),
    );
    // Close the cycle: C.children = [A]
    nodes.insert(
        "C".to_string(),
        mk_node("C", Some("B"), vec!["A".to_string()], 3),
    );
    backend
        .save_nodes(&nodes)
        .await
        .expect("save_nodes should succeed");

    // Bound the test with a generous timeout. Before the visited-set guard,
    // this call would loop until OOM or thread kill; we give it 10s to
    // ensure any legitimate implementation completes quickly.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        kernel
            .domain_operations
            .list_nodes(TEST_ADMIN_USER_ID, None, None, None),
    )
    .await
    .expect("list_nodes with a cycle in children must terminate")
    .expect("list_nodes should return Ok");

    // With the visited guard, each cycle participant appears at most once.
    let ids: std::collections::HashSet<&str> = result.iter().map(|n| n.id.as_str()).collect();
    assert!(ids.contains("A"), "cycle participant A missing");
    assert!(ids.contains("B"), "cycle participant B missing");
    assert!(ids.contains("C"), "cycle participant C missing");
    assert_eq!(
        result.len(),
        ids.len(),
        "no node should be yielded twice under the visited guard"
    );
}

/// A child referenced by two parents should be yielded at most once, and the
/// walk must not fan out exponentially.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_nodes_deduplicates_shared_child() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    // P1 and P2 are both workspace-root children, each claiming SHARED as a child.
    nodes.insert(
        "P1".to_string(),
        mk_node("P1", Some(WORKSPACE_ROOT_ID), vec!["SHARED".to_string()], 1),
    );
    nodes.insert(
        "P2".to_string(),
        mk_node("P2", Some(WORKSPACE_ROOT_ID), vec!["SHARED".to_string()], 1),
    );
    nodes.insert(
        "SHARED".to_string(),
        mk_node("SHARED", Some("P1"), vec![], 2),
    );
    backend
        .save_nodes(&nodes)
        .await
        .expect("save_nodes should succeed");

    let result = kernel
        .domain_operations
        .list_nodes(TEST_ADMIN_USER_ID, None, None, None)
        .await
        .expect("list_nodes should return Ok");

    let shared_hits = result.iter().filter(|n| n.id == "SHARED").count();
    assert_eq!(
        shared_hits, 1,
        "a node referenced by two parents must appear exactly once"
    );
}
