//! A stored snapshot replaces the updates it covers, and the server asks for one when the log
//! has grown by the configured amount.
//!
//! Without compaction the log grows for the life of the document and every new reader replays
//! all of it; with a wrong compaction a reader is sent a snapshot and then updates it already
//! holds, or a snapshot and a gap.

use citadel_workspace_server_kernel::kernel::documents::DocumentsConfig;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

fn store(node: &str, upto_seq: u64, snapshot: &[u8]) -> DocumentsRequest {
    DocumentsRequest::StoreSnapshot {
        node_id: node.to_string(),
        doc_version: 2,
        snapshot: snapshot.to_vec(),
        upto_seq,
    }
}

#[tokio::test]
async fn a_reader_older_than_the_snapshot_gets_it_and_only_the_tail() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let bodies = edits(70, 5);
    for body in &bodies {
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, body).await;
    }
    let s3 = replayed(&bodies[..3]).snapshot();
    let stored = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 3, &s3)).await);
    assert_eq!(
        stored,
        DocumentsResponse::SnapshotStored {
            node_id: node.clone(),
            upto_seq: 3
        }
    );

    let from_scratch = pull(&kernel, TEST_ADMIN_USER_ID, &node, 0).await;
    let DocumentsResponse::Updates {
        snapshot,
        updates,
        latest_seq,
        ..
    } = &from_scratch
    else {
        panic!("expected Updates, got {from_scratch:?}");
    };
    let snapshot = snapshot
        .as_ref()
        .expect("a new reader was not sent the snapshot");
    assert_eq!(
        (
            snapshot.bytes.as_slice(),
            snapshot.upto_seq,
            snapshot.doc_version
        ),
        (s3.as_slice(), 3, 2)
    );
    assert_eq!(
        updates.iter().map(|u| u.seq).collect::<Vec<_>>(),
        vec![4, 5]
    );
    assert_eq!(*latest_seq, 5);

    // Exactly at the snapshot: it already has that state.
    let DocumentsResponse::Updates {
        snapshot, updates, ..
    } = pull(&kernel, TEST_ADMIN_USER_ID, &node, 3).await
    else {
        panic!("expected Updates");
    };
    assert!(
        snapshot.is_none(),
        "a reader at upto_seq was sent the snapshot again"
    );
    assert_eq!(
        updates.iter().map(|u| u.seq).collect::<Vec<_>>(),
        vec![4, 5]
    );
}

#[tokio::test]
async fn numbering_continues_after_a_compaction() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let mut author = Replica::new(70);
    let bodies = vec![author.typed("u1"), author.typed("u2")];
    for body in &bodies {
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, body).await;
    }
    let s2 = replayed(&bodies).snapshot();
    documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 2, &s2)).await);
    assert_eq!(
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &author.typed("u3")).await,
        3
    );
}

#[tokio::test]
async fn a_snapshot_cannot_run_ahead_of_the_log_or_go_back() {
    let kernel = documents_kernel().await;
    let node = document_node(&kernel).await;
    let bodies = edits(70, 3);
    for body in &bodies {
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, body).await;
    }
    let whole = replayed(&bodies).snapshot();
    let ahead = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 4, &whole)).await);
    assert!(
        matches!(
            ahead,
            DocumentsResponse::Refused(DocumentRefusal::SnapshotAhead { latest_seq: 3, .. })
        ),
        "{ahead:?}"
    );
    let s2 = replayed(&bodies[..2]).snapshot();
    documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 2, &s2)).await);
    let behind = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 2, &whole)).await);
    assert!(
        matches!(
            behind,
            DocumentsResponse::Refused(DocumentRefusal::SnapshotBehind {
                stored_upto_seq: 2,
                ..
            })
        ),
        "{behind:?}"
    );
    let kept = pull(&kernel, TEST_ADMIN_USER_ID, &node, 0).await;
    let DocumentsResponse::Updates {
        snapshot: Some(s), ..
    } = kept
    else {
        panic!("the snapshot went missing: {kept:?}");
    };
    assert_eq!(s.bytes, s2, "a refused snapshot replaced the stored one");
}

#[tokio::test]
async fn compaction_is_asked_for_at_the_configured_threshold() {
    let threshold = 3;
    let kernel = with_limits(DocumentsConfig {
        snapshot_min_updates: threshold,
        ..shipped_documents_config()
    })
    .await;
    let node = document_node(&kernel).await;

    let mut author = Replica::new(70);
    let mut bodies = Vec::new();
    let mut hints = Vec::new();
    for i in 0..4u8 {
        bodies.push(author.typed("x"));
        let request = DocumentsRequest::Append {
            node_id: node.clone(),
            doc_version: 1,
            update: bodies[usize::from(i)].clone(),
            client_seq: u64::from(i),
        };
        let DocumentsResponse::Appended { compaction, .. } =
            documents(send(&kernel, TEST_ADMIN_USER_ID, 7, request).await)
        else {
            panic!("append refused");
        };
        hints.push(compaction.map(|c| c.pending));
    }
    assert_eq!(hints, vec![None, None, Some(3), Some(4)]);

    let s4 = replayed(&bodies).snapshot();
    documents(send(&kernel, TEST_ADMIN_USER_ID, 7, store(&node, 4, &s4)).await);
    let after = documents(
        send(
            &kernel,
            TEST_ADMIN_USER_ID,
            7,
            DocumentsRequest::Append {
                node_id: node.clone(),
                doc_version: 1,
                update: author.typed("y"),
                client_seq: 9,
            },
        )
        .await,
    );
    assert!(
        matches!(
            after,
            DocumentsResponse::Appended {
                compaction: None,
                seq: 5,
                ..
            }
        ),
        "the hint did not reset after a snapshot: {after:?}"
    );
}
