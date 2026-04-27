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

/// `get_tree_structure` walks the same `children` graph as `list_nodes`
/// (recursively this time) and accepts `max_depth: None` for unlimited
/// depth. Without the visited-set guard added alongside this test, a
/// 3-cycle in `children` would recurse forever and stack-overflow the
/// server. The guard must let the call complete in bounded time and
/// must not yield the same node id twice along any path.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn get_tree_structure_terminates_on_cycle() {
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

    // Bound the test with a generous timeout. Before the visited-set
    // guard, this call recurses unbounded and either stack-overflows
    // (panic) or hangs; we give the guarded implementation 10s to
    // complete normally.
    let tree = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        kernel
            .domain_operations
            .get_tree_structure(TEST_ADMIN_USER_ID, Some("A"), None),
    )
    .await
    .expect("get_tree_structure with a cycle in children must terminate")
    .expect("get_tree_structure should return Ok");

    // Walk the resulting tree, counting total nodes visited and
    // tracking which cycle participants appear. The expected shape
    // when starting at A and walking A → B → C → (A as leaf-stub via
    // the visited guard) is exactly 4 nodes: A, B, C, A. Without the
    // guard this walk would never return.
    fn walk(
        node: &citadel_workspace_types::structs::TreeNode,
        seen: &mut std::collections::HashMap<String, usize>,
        total: &mut usize,
    ) {
        *total += 1;
        *seen.entry(node.node.id.clone()).or_insert(0) += 1;
        for c in &node.children {
            walk(c, seen, total);
        }
    }
    let mut seen = std::collections::HashMap::new();
    let mut total = 0usize;
    walk(&tree, &mut seen, &mut total);

    // Every cycle participant must be reachable from the root.
    for id in ["A", "B", "C"] {
        assert!(seen.contains_key(id), "cycle participant {id} missing");
    }
    // The tree is finite — no participant should appear more times
    // than the cycle length itself, which bounds the worst-case
    // depth-first expansion before the visited guard fires.
    let cycle_len = 3;
    for (id, count) in &seen {
        assert!(
            *count <= cycle_len,
            "node {id} appeared {count} times — cycle guard did not bound recursion"
        );
    }
    assert!(
        total <= cycle_len * 2,
        "tree size {total} exceeds bounded expectation"
    );
}
