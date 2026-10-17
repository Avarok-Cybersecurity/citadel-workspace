//! Who may write a document, and how much any one request may carry.
//!
//! Writing takes `EditMdx` on the node, as saving its content does; reading it is not enough.
//! Every size is bounded by configuration and an oversize request is refused with the bound it
//! broke, before anything is stored.

use citadel_workspace_server_kernel::kernel::command_processor::async_process_command::process_command_with_user;
use citadel_workspace_server_kernel::kernel::documents::DocumentsConfig;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use common::documents_test_utils::*;
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

fn append_of(node: &str, bytes: usize) -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update: vec![0xAB; bytes],
        client_seq: 1,
    }
}

async fn latest_seq(kernel: &common::member_test_utils::GateKernel, node: &str) -> u64 {
    match pull(kernel, TEST_ADMIN_USER_ID, node, 0).await {
        DocumentsResponse::Updates { latest_seq, .. } => latest_seq,
        other => panic!("expected Updates, got {other:?}"),
    }
}

#[tokio::test]
async fn a_reader_cannot_write_and_a_granted_editor_can() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    reader(&kernel, "reader").await;
    writer(&kernel, "editor", &node).await;

    for request in [
        append_of(&node, 4),
        DocumentsRequest::StoreSnapshot {
            node_id: node.clone(),
            doc_version: 1,
            snapshot: vec![1],
            upto_seq: 0,
        },
    ] {
        let answer = send(&kernel, "reader", 5, request).await;
        assert!(
            matches!(&answer, WorkspaceProtocolResponse::Error(e) if e.contains("EditMdx")),
            "a reader was answered {answer:?}"
        );
    }
    assert_eq!(
        latest_seq(&kernel, &node).await,
        0,
        "a refused write was stored"
    );

    assert_eq!(append(&kernel, "editor", 6, &node, b"mine").await, 1);
}

#[tokio::test]
async fn an_update_one_byte_over_the_bound_is_refused_and_not_stored() {
    let limits = shipped_documents_config();
    let max = limits.max_update_bytes as usize;
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;

    let at_bound = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, append_of(&node, max)).await);
    assert!(
        matches!(at_bound, DocumentsResponse::Appended { .. }),
        "{at_bound:?}"
    );

    let over = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, append_of(&node, max + 1)).await);
    assert_eq!(
        over,
        DocumentsResponse::Refused(DocumentRefusal::UpdateTooLarge {
            node_id: node.clone(),
            bytes: max as u64 + 1,
            max_bytes: max as u64,
        })
    );
    assert_eq!(latest_seq(&kernel, &node).await, 1);
}

#[tokio::test]
async fn snapshots_and_awareness_are_bounded_too() {
    let kernel = with_limits(DocumentsConfig {
        max_snapshot_bytes: 8,
        max_awareness_bytes: 4,
        ..shipped_documents_config()
    })
    .await;
    let node = document_node(&kernel).await;
    append(&kernel, TEST_ADMIN_USER_ID, 7, &node, b"u1").await;

    let snapshot = DocumentsRequest::StoreSnapshot {
        node_id: node.clone(),
        doc_version: 1,
        snapshot: vec![0; 9],
        upto_seq: 1,
    };
    let refused = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, snapshot).await);
    assert!(
        matches!(
            refused,
            DocumentsResponse::Refused(DocumentRefusal::SnapshotTooLarge {
                bytes: 9,
                max_bytes: 8,
                ..
            })
        ),
        "{refused:?}"
    );
    assert_eq!(
        latest_seq(&kernel, &node).await,
        1,
        "a refused snapshot compacted the log"
    );

    let awareness = DocumentsRequest::Awareness {
        node_id: node.clone(),
        payload: vec![0; 5],
    };
    let refused = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, awareness).await);
    assert!(
        matches!(
            refused,
            DocumentsResponse::Refused(DocumentRefusal::AwarenessTooLarge {
                bytes: 5,
                max_bytes: 4,
                ..
            })
        ),
        "{refused:?}"
    );
}

#[tokio::test]
async fn awareness_beyond_the_configured_rate_is_refused() {
    let per_second = 3;
    let kernel = with_limits(DocumentsConfig {
        awareness_per_second: per_second,
        ..shipped_documents_config()
    })
    .await;
    let node = document_node(&kernel).await;
    let cursor = || DocumentsRequest::Awareness {
        node_id: node.clone(),
        payload: vec![1],
    };

    for _ in 0..per_second {
        let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, cursor()).await);
        assert!(
            matches!(answer, DocumentsResponse::AwarenessRelayed { .. }),
            "{answer:?}"
        );
    }
    let limited = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, cursor()).await);
    assert!(
        matches!(
            limited,
            DocumentsResponse::Refused(DocumentRefusal::AwarenessRateLimited { .. })
        ),
        "{limited:?}"
    );
    // Per session: another session's budget is its own.
    let other = documents(send(&kernel, TEST_ADMIN_USER_ID, 8, cursor()).await);
    assert!(
        matches!(other, DocumentsResponse::AwarenessRelayed { .. }),
        "{other:?}"
    );
}

#[tokio::test]
async fn a_write_without_a_session_is_not_attributed_to_nobody() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let answer = process_command_with_user(
        &kernel,
        &WorkspaceProtocolRequest::Documents(append_of(&node, 1)),
        TEST_ADMIN_USER_ID,
    )
    .await
    .expect("dispatch");
    assert!(
        matches!(
            answer,
            WorkspaceProtocolResponse::Documents(DocumentsResponse::Refused(
                DocumentRefusal::NoSession
            ))
        ),
        "{answer:?}"
    );
}

#[tokio::test]
async fn a_kernel_without_limits_refuses_rather_than_guessing() {
    let kernel = create_test_kernel().await;
    let node = document_node(&kernel).await;
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, append_of(&node, 1)).await);
    assert_eq!(
        answer,
        DocumentsResponse::Refused(DocumentRefusal::NotConfigured)
    );
}
