//! The relay stores only CRDT bytes it can read, and a snapshot only if it holds what it
//! compacts.
//!
//! A stored update every reader fails to apply poisons the document for all of them; a snapshot
//! missing what the log wrote erases it for every reader older than the snapshot. So both are
//! decoded before they are stored, and a snapshot's state vector must hold every clock the
//! updates it covers write.

use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::member_test_utils::GateKernel;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

const CLIENT: u64 = 70;

fn store(node: &str, upto_seq: u64, snapshot: Vec<u8>) -> DocumentsRequest {
    DocumentsRequest::StoreSnapshot {
        node_id: node.to_string(),
        doc_version: 1,
        snapshot,
        upto_seq,
    }
}

async fn written(kernel: &GateKernel, node: &str, n: usize) -> Vec<Vec<u8>> {
    let bodies = edits(CLIENT, n);
    for body in &bodies {
        append(kernel, TEST_ADMIN_USER_ID, 7, node, body).await;
    }
    bodies
}

/// The log as a new reader receives it: (snapshot upto, update seqs).
async fn as_read(kernel: &GateKernel, node: &str) -> (Option<u64>, Vec<u64>) {
    match pull(kernel, TEST_ADMIN_USER_ID, node, 0).await {
        DocumentsResponse::Updates {
            snapshot, updates, ..
        } => (
            snapshot.map(|s| s.upto_seq),
            updates.iter().map(|u| u.seq).collect(),
        ),
        other => panic!("expected Updates, got {other:?}"),
    }
}

#[tokio::test]
async fn an_update_that_does_not_decode_is_refused_and_not_stored() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let mut truncated = Replica::new(CLIENT).typed("hello");
    truncated.pop();
    for garbage in [vec![0xAB; 16], truncated] {
        let request = DocumentsRequest::Append {
            node_id: node.clone(),
            doc_version: 1,
            update: garbage,
            client_seq: 1,
        };
        let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, request).await);
        assert!(
            matches!(
                &answer,
                DocumentsResponse::Refused(DocumentRefusal::UpdateMalformed { node_id, .. })
                    if *node_id == node
            ),
            "{answer:?}"
        );
    }
    assert_eq!(as_read(&kernel, &node).await, (None, vec![]));
}

#[tokio::test]
async fn a_blank_snapshot_of_a_written_log_is_refused_and_destroys_nothing() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    written(&kernel, &node, 3).await;
    let blank = Replica::new(CLIENT + 1).snapshot();
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 3, blank)).await);
    assert!(
        matches!(
            answer,
            DocumentsResponse::Refused(DocumentRefusal::SnapshotIncomplete {
                upto_seq: 3,
                crdt_client: CLIENT,
                held_clock: 0,
                ..
            })
        ),
        "{answer:?}"
    );
    assert_eq!(as_read(&kernel, &node).await, (None, vec![1, 2, 3]));
}

#[tokio::test]
async fn a_snapshot_short_of_its_upto_is_refused_and_one_at_it_stored() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let bodies = written(&kernel, &node, 3).await;
    let short = replayed(&bodies[..2]).snapshot();
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 3, short)).await);
    assert!(
        matches!(
            answer,
            DocumentsResponse::Refused(DocumentRefusal::SnapshotIncomplete { .. })
        ),
        "{answer:?}"
    );
    let whole = replayed(&bodies).snapshot();
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 3, whole)).await);
    assert!(
        matches!(
            answer,
            DocumentsResponse::SnapshotStored { upto_seq: 3, .. }
        ),
        "{answer:?}"
    );
    assert_eq!(as_read(&kernel, &node).await, (Some(3), vec![]));
}

#[tokio::test]
async fn a_damaged_snapshot_is_refused_by_name() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let bodies = written(&kernel, &node, 2).await;
    let mut damaged = replayed(&bodies).snapshot();
    damaged.truncate(damaged.len() - 1);
    for bytes in [damaged, vec![1, 2, 3], bodies[0].clone()] {
        let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 2, bytes)).await);
        assert!(
            matches!(
                answer,
                DocumentsResponse::Refused(DocumentRefusal::SnapshotMalformed { .. })
            ),
            "{answer:?}"
        );
    }
    assert_eq!(as_read(&kernel, &node).await, (None, vec![1, 2]));
}

#[tokio::test]
async fn a_pull_from_the_last_possible_seq_is_answered_empty() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    written(&kernel, &node, 2).await;
    let answer = pull(&kernel, TEST_ADMIN_USER_ID, &node, u64::MAX).await;
    assert!(
        matches!(
            &answer,
            DocumentsResponse::Updates { snapshot: None, updates, has_more: false, latest_seq: 2, .. }
                if updates.is_empty()
        ),
        "{answer:?}"
    );
}
