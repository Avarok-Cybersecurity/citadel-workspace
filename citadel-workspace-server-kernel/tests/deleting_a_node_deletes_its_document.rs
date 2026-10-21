//! A deleted node takes its document with it: every update, the snapshot and the head.
//!
//! The chat history of a deleted room once stayed on the server forever, unreachable because
//! the node that named its key was gone (`deleted_rooms_take_their_history.rs`). A document log
//! is keyed the same way, so it is asked the same question. To observe the storage through the
//! protocol, a node with the deleted node's id is put back afterwards: a log that survived would
//! be read straight back out of it.

use citadel_workspace_server_kernel::handlers::domain::node_ops::AsyncNodeOperations;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::structs::{DomainNode, NodeEntityType};
use citadel_workspace_types::WorkspaceProtocolResponse;
use common::documents_test_utils::*;
use common::member_test_utils::GateKernel;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

async fn node_record(kernel: &GateKernel, id: &str) -> DomainNode {
    kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes()
        .await
        .expect("read nodes")
        .remove(id)
        .expect("the node exists")
}

/// Put the records back as they were, ids and all.
async fn restore(kernel: &GateKernel, records: Vec<DomainNode>) {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let _nodes = backend.lock_nodes().await;
    let mut nodes = backend.get_all_nodes().await.expect("read nodes");
    for record in records {
        nodes.insert(record.id.clone(), record);
    }
    backend.save_nodes(&nodes).await.expect("restore nodes");
}

async fn write_a_document(kernel: &GateKernel, node: &str) {
    let bodies = edits(70, 3);
    for body in &bodies {
        append(kernel, TEST_ADMIN_USER_ID, 7, node, body).await;
    }
    let snapshot = DocumentsRequest::StoreSnapshot {
        node_id: node.to_string(),
        doc_version: 1,
        snapshot: replayed(&bodies[..2]).snapshot(),
        upto_seq: 2,
    };
    assert!(matches!(
        documents(send(kernel, TEST_ADMIN_USER_ID, 7, snapshot).await),
        DocumentsResponse::SnapshotStored { .. }
    ));
}

fn refused(answer: &WorkspaceProtocolResponse) -> bool {
    matches!(
        answer,
        WorkspaceProtocolResponse::Error(_)
            | WorkspaceProtocolResponse::Documents(DocumentsResponse::Refused(
                DocumentRefusal::NoSuchNode { .. }
            ))
    )
}

fn assert_empty(response: DocumentsResponse, what: &str) {
    assert!(
        matches!(
            &response,
            DocumentsResponse::Updates { snapshot: None, updates, latest_seq: 0, .. } if updates.is_empty()
        ),
        "{what}'s document survived its deletion: {response:?}"
    );
}

#[tokio::test]
async fn deleting_a_node_drops_its_updates_and_snapshot() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let other = document_node(&kernel).await;
    write_a_document(&kernel, &node).await;
    let keep = Replica::new(71).typed("keep");
    append(&kernel, TEST_ADMIN_USER_ID, 7, &other, &keep).await;
    let record = node_record(&kernel, &node).await;

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, &node, false)
        .await
        .expect("delete");

    // Refused, by the permission walk (a deleted node is in no workspace) or, for a request
    // that raced the delete past it, by the existence check under the log's lock.
    for request in [
        DocumentsRequest::Pull {
            node_id: node.clone(),
            since_seq: 0,
        },
        DocumentsRequest::Append {
            node_id: node.clone(),
            doc_version: 1,
            update: Replica::new(70).typed("late"),
            client_seq: 1,
        },
    ] {
        let answer = send(&kernel, TEST_ADMIN_USER_ID, 7, request).await;
        assert!(
            refused(&answer),
            "a deleted node's document was served: {answer:?}"
        );
    }

    restore(&kernel, vec![record]).await;
    assert_empty(
        pull(&kernel, TEST_ADMIN_USER_ID, &node, 0).await,
        "the deleted node",
    );
    assert_eq!(
        pulled(&pull(&kernel, TEST_ADMIN_USER_ID, &other, 0).await),
        vec![keep],
        "deleting one node touched another's document"
    );
}

#[tokio::test]
async fn a_cascading_delete_drops_every_descendants_document() {
    let kernel = documents_kernel().await;
    let parent = document_node(&kernel).await;
    let child = kernel
        .domain_operations
        .create_node(
            TEST_ADMIN_USER_ID,
            Some(&parent),
            &NodeEntityType::Child("Room".to_string()),
            "Draft",
            "",
            None,
        )
        .await
        .expect("create child")
        .id;
    write_a_document(&kernel, &parent).await;
    write_a_document(&kernel, &child).await;
    let records = vec![
        node_record(&kernel, &parent).await,
        node_record(&kernel, &child).await,
    ];

    kernel
        .domain_operations
        .delete_node(TEST_ADMIN_USER_ID, &parent, true)
        .await
        .expect("cascade delete");

    restore(&kernel, records).await;
    assert_empty(
        pull(&kernel, TEST_ADMIN_USER_ID, &parent, 0).await,
        "the parent",
    );
    assert_empty(
        pull(&kernel, TEST_ADMIN_USER_ID, &child, 0).await,
        "the child",
    );
}
