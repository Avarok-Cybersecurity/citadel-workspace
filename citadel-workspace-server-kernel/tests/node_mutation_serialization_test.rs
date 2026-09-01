//! # `update_node` must serialize its read-modify-write, and the tree walks must terminate
//!
//! Three defects covered here, all in the node/tree layer:
//!
//! 1. `update_node` read a single node and wrote it back across its own awaits
//!    with no `lock_nodes()` guard — the only one of the node mutators to skip
//!    it. Because `nodes` is ONE HashMap-shaped backend key, that is a
//!    load-modify-save over the whole map: a concurrent create/move/delete
//!    silently drops the edit, or resurrects a node the other caller removed.
//!
//! 2. `is_ancestor_of` and `get_subtree_max_depth` walked the tree with no
//!    visited set, while `get_descendants` in the same file had one. Both are
//!    called from `validate_mutation` *while `lock_nodes` is held*, so a single
//!    cyclic tree would wedge every node operation in the workspace forever
//!    rather than reporting the corruption.
//!
//! 3. `list_nodes(parent_id = Some(WORKSPACE_ROOT_ID))` returned `Ok([])` on a
//!    populated workspace: the root is a sentinel, not a stored DomainNode, so
//!    the lookup missed and fell through to `unwrap_or_default()`.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_server_kernel::handlers::domain::tree_validator::{
    NodeMutation, TreeValidator,
};
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType, TreeSchema};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;
use std::time::Duration;

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

/// `update_node` must hold the nodes lock across its READ as well as its write.
///
/// The write alone was already safe — the backend's `update_node` takes the same
/// mutex — so a test that merely checks "does it block while the lock is held"
/// passes with the bug still in place. It was written that way first and stayed
/// green under the negative control. The property that actually distinguishes
/// the two is whether the node is re-read *after* the lock is acquired.
///
/// So: hold the lock, let an update reach its blocking point, then change the
/// node from under it before releasing. An implementation that read early
/// carries a stale copy and writes our change away.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn update_node_reads_under_the_lock_and_does_not_revert_a_concurrent_write() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "A".to_string(),
        mk_node("A", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    backend.save_nodes(&nodes).await.expect("seed nodes");

    let guard = backend.lock_nodes().await;

    let ops = kernel.domain_operations.clone();
    let updating = tokio::spawn(async move {
        ops.update_node(
            TEST_ADMIN_USER_ID,
            "A",
            Some("renamed-by-update"),
            None,
            None,
            None,
            None,
            None,
        )
        .await
    });

    // Let the update run as far as it can. An implementation that reads before
    // taking the lock has now read; one that reads after is parked on the mutex.
    tokio::time::sleep(Duration::from_millis(300)).await;

    // A legitimate concurrent writer, holding the lock as the contract requires.
    let mut nodes = backend.get_all_nodes().await.expect("read nodes");
    nodes.get_mut("A").expect("node A").description = "set-by-concurrent-writer".to_string();
    backend.save_nodes(&nodes).await.expect("concurrent write");

    drop(guard);

    let updated = tokio::time::timeout(Duration::from_secs(10), updating)
        .await
        .expect("update_node must complete once the lock is free")
        .expect("update task should not panic")
        .expect("update_node should return Ok");

    assert_eq!(
        updated.name, "renamed-by-update",
        "the update itself must land"
    );

    let persisted = backend
        .get_node("A")
        .await
        .expect("get_node should succeed")
        .expect("node A should still exist");

    assert_eq!(
        persisted.name, "renamed-by-update",
        "the rename must be visible in the persisted nodes map"
    );
    assert_eq!(
        persisted.description, "set-by-concurrent-writer",
        "update_node read node A before acquiring the nodes lock and wrote a \
         stale copy back, reverting a write that completed while it waited"
    );
}

/// Run a synchronous validator call on its own OS thread and give it a deadline.
///
/// `tokio::time::timeout` is useless against these walks: they are synchronous,
/// so an unguarded loop never yields and the timeout future is never polled —
/// the test would hang forever instead of failing. A real thread plus
/// `recv_timeout` is the only bound that actually holds, and it is what makes
/// the negative control for these two fixes terminate.
fn validate_within(
    label: &str,
    nodes: HashMap<String, DomainNode>,
    mutation: NodeMutation,
    schema: Option<TreeSchema>,
) {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name(format!("validate-{label}"))
        // A cycle in the children BFS grows its queue without bound as it spins.
        // Cap the stack so a regression dies fast instead of eating the machine.
        .stack_size(1 << 20)
        .spawn(move || {
            let outcome = match &schema {
                Some(sch) => TreeValidator::validate_mutation_with_schema(&nodes, &mutation, sch),
                None => TreeValidator::validate_mutation(&nodes, &mutation),
            };
            // Send may fail if the test already gave up; that is fine.
            let _ = tx.send(outcome.is_ok());
        })
        .expect("spawn validator thread");

    assert!(
        rx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "{label}: the tree walk never returned. It runs inside `lock_nodes`, so \
         in production this wedges every node operation in the workspace \
         permanently rather than reporting the corrupt tree"
    );
    // The verdict itself is deliberately unasserted: on an already-cyclic tree
    // either answer is defensible. Not returning is not.
}

/// A cycle in `parent_id` must not hang the move validator. Before the visited
/// set, `is_ancestor_of` walked the ring forever.
#[test]
fn move_validation_terminates_on_a_parent_cycle() {
    // X -> Y -> Z -> X via parent_id. Moving `target` under X makes the
    // validator walk X's ancestor chain looking for a would-be cycle.
    let mut nodes = HashMap::new();
    nodes.insert("X".to_string(), mk_node("X", Some("Z"), vec![], 1));
    nodes.insert("Y".to_string(), mk_node("Y", Some("X"), vec![], 2));
    nodes.insert("Z".to_string(), mk_node("Z", Some("Y"), vec![], 3));
    nodes.insert(
        "target".to_string(),
        mk_node("target", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );

    validate_within(
        "parent-cycle",
        nodes,
        NodeMutation::Move {
            node_id: "target".to_string(),
            new_parent_id: "X".to_string(),
        },
        None,
    );
}

/// The depth check walks the subtree by `children`. A cycle there must not hang
/// it — and, unlike the parent walk, an unguarded BFS also grows its queue
/// without bound, so the hang takes the process's memory with it.
#[test]
fn move_validation_terminates_on_a_children_cycle_under_a_depth_limit() {
    // P -> Q -> P through `children`, carried as `mover`'s subtree so the depth
    // walk enters the ring.
    let mut nodes = HashMap::new();
    nodes.insert(
        "dest".to_string(),
        mk_node("dest", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    nodes.insert(
        "mover".to_string(),
        mk_node("mover", Some(WORKSPACE_ROOT_ID), vec!["P".to_string()], 1),
    );
    nodes.insert(
        "P".to_string(),
        mk_node("P", Some("mover"), vec!["Q".to_string()], 2),
    );
    nodes.insert(
        "Q".to_string(),
        mk_node("Q", Some("P"), vec!["P".to_string()], 3),
    );

    // `get_subtree_max_depth` is only reached when the schema sets max_depth.
    // Empty rules => every child type allowed, so the type check passes and the
    // depth check runs.
    validate_within(
        "children-cycle",
        nodes,
        NodeMutation::Move {
            node_id: "mover".to_string(),
            new_parent_id: "dest".to_string(),
        },
        Some(TreeSchema {
            id: "depth-limited".to_string(),
            name: "Depth Limited".to_string(),
            rules: vec![],
            max_depth: Some(50),
            entity_type_configs: vec![],
        }),
    );
}

/// Asking for the root's children by its sentinel id must return them. This
/// returned `Ok([])` on a populated tree — an empty workspace, reported as fact.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_nodes_accepts_the_root_sentinel_as_a_parent() {
    let kernel = create_test_kernel().await;
    let backend = &kernel.domain_operations.backend_tx_manager;

    let mut nodes = HashMap::new();
    nodes.insert(
        "top-1".to_string(),
        mk_node("top-1", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    nodes.insert(
        "top-2".to_string(),
        mk_node("top-2", Some(WORKSPACE_ROOT_ID), vec![], 1),
    );
    backend.save_nodes(&nodes).await.expect("seed nodes");

    let explicit = kernel
        .domain_operations
        .list_nodes(TEST_ADMIN_USER_ID, Some(WORKSPACE_ROOT_ID), None, None)
        .await
        .expect("list_nodes should return Ok");

    let implicit = kernel
        .domain_operations
        .list_nodes(TEST_ADMIN_USER_ID, None, None, None)
        .await
        .expect("list_nodes should return Ok");

    assert!(
        !explicit.is_empty(),
        "list_nodes(parent = \"{WORKSPACE_ROOT_ID}\") returned an empty list on a \
         populated workspace: the root sentinel is not a stored node, so the \
         parent lookup missed and fell through to a default"
    );

    let mut explicit_ids: Vec<&str> = explicit.iter().map(|n| n.id.as_str()).collect();
    let mut implicit_ids: Vec<&str> = implicit.iter().map(|n| n.id.as_str()).collect();
    explicit_ids.sort_unstable();
    implicit_ids.sort_unstable();
    assert_eq!(
        explicit_ids, implicit_ids,
        "naming the root explicitly must mean the same thing as passing None"
    );
}
