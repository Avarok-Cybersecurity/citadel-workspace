//! A node keeps the metadata document it was created with.
//!
//! The client has long sent `metadata` in `CreateNode`; the request had no such field, so
//! serde dropped it and every node was stored with empty metadata. A document node records
//! the Citadel App it opens in there, so dropping it made every document an ordinary room.
//!
//! No mocks: the real command processor and storage, and the node read back afterwards.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::WORKSPACE_ROOT_ID;
use citadel_workspace_types::structs::{DomainNode, NodeEntityType};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::member_test_utils::GateKernel as Kernel;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

const DOCS_APP: &[u8] = br#"{"citadel_app":{"v":1,"kind":"citadel-app","payload":{"app":"docs"}}}"#;

async fn send(kernel: &Kernel, request: WorkspaceProtocolRequest) -> WorkspaceProtocolResponse {
    process_command_with_user(kernel, &request, TEST_ADMIN_USER_ID)
        .await
        .expect("dispatch failed")
}

async fn create_with(kernel: &Kernel, metadata: Option<&[u8]>) -> WorkspaceProtocolResponse {
    send(
        kernel,
        WorkspaceProtocolRequest::CreateNode {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            entity_type: NodeEntityType::Child("Office".to_string()),
            name: "Quarterly plan".to_string(),
            description: String::new(),
            metadata: metadata.map(<[u8]>::to_vec),
        },
    )
    .await
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
        other => panic!("node {id} did not read back: {other:?}"),
    }
}

fn as_json(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("stored metadata is a JSON document")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_metadata_sent_is_the_metadata_stored_and_read_back() {
    let kernel = create_test_kernel().await;
    let node = match create_with(&kernel, Some(DOCS_APP)).await {
        WorkspaceProtocolResponse::Node(node) => node,
        other => panic!("creating a node with metadata was refused: {other:?}"),
    };
    assert_eq!(
        as_json(&node.metadata),
        as_json(DOCS_APP),
        "the answer lost the metadata"
    );

    let stored = read(&kernel, &node.id).await;
    assert_eq!(
        as_json(&stored.metadata),
        as_json(DOCS_APP),
        "storage lost the metadata"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_node_created_without_metadata_has_none() {
    let kernel = create_test_kernel().await;
    let node = match create_with(&kernel, None).await {
        WorkspaceProtocolResponse::Node(node) => node,
        other => panic!("creating a plain node was refused: {other:?}"),
    };
    assert!(read(&kernel, &node.id).await.metadata.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn metadata_that_is_not_a_json_object_is_refused_and_nothing_is_created() {
    let kernel = create_test_kernel().await;
    match create_with(&kernel, Some(b"[1,2,3]")).await {
        WorkspaceProtocolResponse::Error(reason) => {
            assert!(
                reason.contains("JSON object"),
                "unexpected reason: {reason}"
            )
        }
        other => panic!("a non-object metadata document was accepted: {other:?}"),
    }
    let listed = send(
        &kernel,
        WorkspaceProtocolRequest::ListNodes {
            parent_id: Some(WORKSPACE_ROOT_ID.to_string()),
            depth: None,
            entity_types: None,
        },
    )
    .await;
    assert!(
        !format!("{listed:?}").contains("Quarterly plan"),
        "a refused create still stored the node: {listed:?}"
    );
}
