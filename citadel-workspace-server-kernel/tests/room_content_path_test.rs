//! A room's document must be written where the loader reads rooms from.
//!
//! `persist_node_content` took a single node NAME and wrote
//! `{base}/{name}/CONTENT.md`. The boot loader reads offices from
//! `{base}/{office}/CONTENT.md` and rooms from `{base}/{office}/{room}/CONTENT.md`
//! — so every room edit landed at a path the loader interprets as an OFFICE.
//!
//! Three consequences, all silent: the user's edit was written somewhere the
//! room is never read from, so on the next restart the room came back with its
//! seed content and the edit was gone; a phantom office appeared, named after
//! the room, holding the orphaned text; and two rooms with the same name in
//! different offices overwrote each other.
//!
//! The correctly-pathed `persist_room_content` already existed. This path just
//! never called it.

use citadel_sdk::prelude::MonoRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};
use std::collections::HashMap;

fn mk_node(
    id: &str,
    name: &str,
    parent: Option<&str>,
    children: Vec<String>,
    depth: u32,
) -> DomainNode {
    DomainNode {
        id: id.to_string(),
        parent_id: parent.map(|s| s.to_string()),
        entity_type: NodeEntityType::Child("Room".to_string()),
        depth,
        name: name.to_string(),
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

/// Engineering (office, under the root) → Standup (room inside it).
type TestKernel = AsyncWorkspaceServerKernel<MonoRatchet>;

async fn seed(kernel: &TestKernel) {
    let mut nodes = HashMap::new();
    nodes.insert(
        "office-1".to_string(),
        mk_node(
            "office-1",
            "Engineering",
            Some(WORKSPACE_ROOT_ID),
            vec!["room-1".to_string()],
            1,
        ),
    );
    nodes.insert(
        "room-1".to_string(),
        mk_node("room-1", "Standup", Some("office-1"), vec![], 2),
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .save_nodes(&nodes)
        .await
        .expect("seed nodes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_resolves_to_its_office_and_its_own_name() {
    let kernel = create_test_kernel().await;
    seed(&kernel).await;

    let segments = kernel.content_path_segments("room-1").await;

    // Root first. Joined onto the base path this is
    // {base}/Engineering/Standup/CONTENT.md — where the loader reads rooms.
    assert_eq!(
        segments,
        vec!["Engineering".to_string(), "Standup".to_string()],
        "a room's path must include its office; a bare name is read as an office"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_office_resolves_to_a_single_segment() {
    let kernel = create_test_kernel().await;
    seed(&kernel).await;

    assert_eq!(
        kernel.content_path_segments("office-1").await,
        vec!["Engineering".to_string()],
        "an office sits directly under the base path"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_rooms_named_alike_in_different_offices_do_not_collide() {
    let kernel = create_test_kernel().await;

    let mut nodes = HashMap::new();
    nodes.insert(
        "office-a".to_string(),
        mk_node(
            "office-a",
            "Alpha",
            Some(WORKSPACE_ROOT_ID),
            vec!["room-a".to_string()],
            1,
        ),
    );
    nodes.insert(
        "office-b".to_string(),
        mk_node(
            "office-b",
            "Beta",
            Some(WORKSPACE_ROOT_ID),
            vec!["room-b".to_string()],
            1,
        ),
    );
    nodes.insert(
        "room-a".to_string(),
        mk_node("room-a", "Standup", Some("office-a"), vec![], 2),
    );
    nodes.insert(
        "room-b".to_string(),
        mk_node("room-b", "Standup", Some("office-b"), vec![], 2),
    );
    kernel
        .domain_operations
        .backend_tx_manager
        .save_nodes(&nodes)
        .await
        .expect("seed nodes");

    let a = kernel.content_path_segments("room-a").await;
    let b = kernel.content_path_segments("room-b").await;

    // Under the old single-name path both were {base}/Standup/CONTENT.md, so
    // editing one silently overwrote the other.
    assert_ne!(
        a, b,
        "same-named rooms in different offices must not share a file"
    );
    assert_eq!(a, vec!["Alpha".to_string(), "Standup".to_string()]);
    assert_eq!(b, vec!["Beta".to_string(), "Standup".to_string()]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unresolvable_node_yields_no_path_rather_than_a_guess() {
    let kernel = create_test_kernel().await;
    seed(&kernel).await;

    assert!(
        kernel
            .content_path_segments("does-not-exist")
            .await
            .is_empty(),
        "an unknown node must not resolve to a path"
    );

    // And the writer refuses rather than inventing one.
    assert!(
        kernel
            .persist_node_content_at(&[], "content")
            .await
            .is_err(),
        "writing with no resolved path must fail loudly"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_parent_cycle_does_not_hang_the_walk() {
    let kernel = create_test_kernel().await;

    let mut nodes = HashMap::new();
    nodes.insert("x".to_string(), mk_node("x", "X", Some("y"), vec![], 1));
    nodes.insert("y".to_string(), mk_node("y", "Y", Some("x"), vec![], 1));
    kernel
        .domain_operations
        .backend_tx_manager
        .save_nodes(&nodes)
        .await
        .expect("seed nodes");

    let segments = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        kernel.content_path_segments("x"),
    )
    .await
    .expect("the ancestor walk must terminate on a cyclic tree");

    assert!(
        segments.is_empty(),
        "a corrupt chain must not produce a path"
    );
}
