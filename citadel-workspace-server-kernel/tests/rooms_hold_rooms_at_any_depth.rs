//! Rooms hold rooms, offices hold offices, and a tree may be as deep as an organisation is.
//!
//! The restriction was data, not code: the default schema made rooms leaves and capped the
//! depth at 3, and every node kept the `allowed_child_types` its schema had when it was
//! created, so even a widened schema never reached an existing node. Allowed children are now
//! read from the live schema whenever a node is read.
//!
//! No mocks: the real command processor and storage.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, NestingRule, NodeEntityType, TreeSchema};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

async fn send(kernel: &Kernel, request: WorkspaceProtocolRequest) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatch failed")
}

async fn create(kernel: &Kernel, parent: &str, ty: &str) -> WorkspaceProtocolResponse {
    send(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(parent.to_string()),
            entity_type: NodeEntityType::Child(ty.to_string()),
            name: format!("{ty} under {parent}"),
            description: String::new(),
            metadata: None,
        },
    )
    .await
}

async fn created(kernel: &Kernel, parent: &str, ty: &str) -> DomainNode {
    match create(kernel, parent, ty).await {
        WorkspaceProtocolResponse::Node(node) => node,
        other => panic!("creating a {ty} under {parent} was refused: {other:?}"),
    }
}

async fn read(kernel: &Kernel, id: &str) -> DomainNode {
    match send(
        kernel,
        WorkspaceProtocolRequest::GetNode {
            node_id: id.to_string(),
        },
    )
    .await
    {
        WorkspaceProtocolResponse::Node(node) => node,
        other => panic!("GetNode({id}) failed: {other:?}"),
    }
}

fn names(types: &[&str]) -> Option<Vec<String>> {
    Some(types.iter().map(|t| t.to_string()).collect())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_is_accepted_under_a_room() {
    let kernel = create_test_kernel().await;
    let office = created(&kernel, WORKSPACE_ROOT_ID, "Office").await;
    let room = created(&kernel, &office.id, "Room").await;
    let inner = created(&kernel, &room.id, "Room").await;
    assert_eq!(inner.depth, room.depth + 1);
    let sub_office = created(&kernel, &office.id, "Office").await;
    assert_eq!(sub_office.allowed_child_types, names(&["Room", "Office"]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_tree_twenty_deep_is_accepted() {
    let kernel = create_test_kernel().await;
    let mut parent = created(&kernel, WORKSPACE_ROOT_ID, "Office").await.id;
    for _ in 0..19 {
        parent = created(&kernel, &parent, "Room").await.id;
    }
    assert_eq!(read(&kernel, &parent).await.depth, 20);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_room_is_still_refused_under_the_workspace() {
    let kernel = create_test_kernel().await;
    let response = create(&kernel, WORKSPACE_ROOT_ID, "Room").await;
    assert!(
        matches!(&response, WorkspaceProtocolResponse::Error(e) if e.contains("not allowed")),
        "a Room directly under the workspace was not refused: {response:?}"
    );
}

/// A schema change reaches nodes that already exist, on every read path.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn allowed_children_follow_the_live_schema() {
    let kernel = create_test_kernel().await;
    let office = created(&kernel, WORKSPACE_ROOT_ID, "Office").await;
    let room = created(&kernel, &office.id, "Room").await;
    assert_eq!(room.allowed_child_types, names(&["Room"]));

    let mut schema = TreeSchema::default();
    schema.rules.retain(|r| r.parent_type != "Room");
    schema.rules.push(NestingRule {
        parent_type: "Room".to_string(),
        allowed_child_types: vec![],
    });
    let saved = send(
        &kernel,
        WorkspaceProtocolRequest::UpdateTreeSchema { schema },
    )
    .await;
    assert!(
        matches!(saved, WorkspaceProtocolResponse::TreeSchema(_)),
        "{saved:?}"
    );

    assert_eq!(
        read(&kernel, &room.id).await.allowed_child_types,
        names(&[])
    );
    let listed = send(
        &kernel,
        WorkspaceProtocolRequest::ListNodes {
            parent_id: Some(office.id.clone()),
            depth: Some(0),
            entity_types: None,
        },
    )
    .await;
    match listed {
        WorkspaceProtocolResponse::Nodes(nodes) => {
            let listed_room = nodes.iter().find(|n| n.id == room.id).expect("room listed");
            assert_eq!(listed_room.allowed_child_types, names(&[]));
        }
        other => panic!("ListNodes failed: {other:?}"),
    }
    let tree = send(
        &kernel,
        WorkspaceProtocolRequest::GetTreeStructure {
            root_id: Some(office.id.clone()),
            max_depth: None,
        },
    )
    .await;
    match tree {
        WorkspaceProtocolResponse::TreeStructure { root: tree } => {
            assert_eq!(tree.node.allowed_child_types, names(&["Room", "Office"]));
            assert_eq!(tree.children[0].node.allowed_child_types, names(&[]));
        }
        other => panic!("GetTreeStructure failed: {other:?}"),
    }
}

/// What a node created before this change carries is ignored on read: the snapshot it took
/// at creation said a Room has no children.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stored_snapshot_is_not_what_a_read_reports() {
    let kernel = create_test_kernel().await;
    let office = created(&kernel, WORKSPACE_ROOT_ID, "Office").await;
    let room = created(&kernel, &office.id, "Room").await;
    let backend = &kernel.domain_operations.backend_tx_manager;
    let mut nodes = backend.get_all_nodes().await.expect("read nodes");
    nodes
        .get_mut(&room.id)
        .expect("room stored")
        .allowed_child_types = Some(vec![]);
    backend.save_nodes(&nodes).await.expect("save nodes");

    assert_eq!(
        read(&kernel, &room.id).await.allowed_child_types,
        names(&["Room"])
    );
}
