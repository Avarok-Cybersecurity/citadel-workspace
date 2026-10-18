//! How fast one session may append and pull, and how much a document's log may hold before it
//! is compacted.
//!
//! Every append is stored, decoded and announced to every reader, and every pull reads the
//! store: unbounded, one editor could fill the store or saturate every reader's connection.

use citadel_workspace_server_kernel::kernel::documents::DocumentsConfig;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

fn append_request(node: &str, update: Vec<u8>) -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update,
        client_seq: 1,
    }
}

#[tokio::test]
async fn the_append_past_the_configured_rate_is_refused_and_not_stored() {
    let per_second = 20;
    let kernel = with_limits(DocumentsConfig {
        appends_per_second: per_second,
        ..shipped_documents_config()
    })
    .await;
    let node = document_node(&kernel).await;
    let mut author = Replica::new(70);
    for i in 1..=u64::from(per_second) {
        assert_eq!(
            append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &author.typed("x")).await,
            i
        );
    }
    let limited = documents(
        send(
            &kernel,
            TEST_ADMIN_USER_ID,
            7,
            append_request(&node, author.typed("x")),
        )
        .await,
    );
    assert_eq!(
        limited,
        DocumentsResponse::Refused(DocumentRefusal::AppendRateLimited {
            node_id: node.clone()
        }),
        "append {} in a second was admitted",
        per_second + 1
    );
    // Per session: another session's budget is its own.
    let other = Replica::new(71).typed("y");
    assert_eq!(
        append(&kernel, TEST_ADMIN_USER_ID, 8, &node, &other).await,
        u64::from(per_second) + 1
    );
}

#[tokio::test]
async fn the_pull_past_the_configured_rate_is_refused() {
    let per_second = 3;
    let kernel = with_limits(DocumentsConfig {
        pulls_per_second: per_second,
        ..shipped_documents_config()
    })
    .await;
    let node = document_node(&kernel).await;
    let request = || DocumentsRequest::Pull {
        node_id: node.clone(),
        since_seq: 0,
    };
    for _ in 0..per_second {
        let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 9, request()).await);
        assert!(
            matches!(answer, DocumentsResponse::Updates { .. }),
            "{answer:?}"
        );
    }
    let limited = documents(send(&kernel, TEST_ADMIN_USER_ID, 9, request()).await);
    assert_eq!(
        limited,
        DocumentsResponse::Refused(DocumentRefusal::PullRateLimited {
            node_id: node.clone()
        })
    );
}

#[tokio::test]
async fn appends_past_the_log_cap_are_refused_until_a_snapshot_compacts_it() {
    // An orphaned update cannot be materialised, so the server cannot compact this log itself:
    // only the writer's snapshot can, which is what the cap waits for here.
    let update_bytes = 1024;
    let limits = DocumentsConfig {
        snapshot_min_updates: 1,
        max_update_bytes: update_bytes,
        compact_at_pending_bytes: update_bytes,
        max_pending_log_bytes: 3 * update_bytes,
        ..shipped_documents_config()
    };
    let kernel = with_limits(limits).await;
    let node = document_node(&kernel).await;
    let mut author = Replica::new(70);
    let filler = "f".repeat(900);
    let mut stored = Vec::new();
    loop {
        let update = author.orphaned(&filler);
        let answer = documents(
            send(
                &kernel,
                TEST_ADMIN_USER_ID,
                7,
                append_request(&node, update.clone()),
            )
            .await,
        );
        match answer {
            DocumentsResponse::Appended { .. } => stored.push(update),
            DocumentsResponse::Refused(DocumentRefusal::LogFull {
                pending_bytes,
                max_bytes,
                ..
            }) => {
                assert_eq!(max_bytes, limits.max_pending_log_bytes);
                assert!(pending_bytes + update.len() as u64 > max_bytes);
                break;
            }
            other => panic!("expected Appended or LogFull, got {other:?}"),
        }
        assert!(stored.len() < 10, "the log was never full");
    }
    let latest = stored.len() as u64;
    let snapshot = DocumentsRequest::StoreSnapshot {
        node_id: node.clone(),
        doc_version: 1,
        snapshot: author.snapshot(),
        upto_seq: latest,
    };
    let answer = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, snapshot).await);
    assert!(
        matches!(answer, DocumentsResponse::SnapshotStored { .. }),
        "{answer:?}"
    );
    assert_eq!(
        append(
            &kernel,
            TEST_ADMIN_USER_ID,
            7,
            &node,
            &author.typed("after")
        )
        .await,
        latest + 1
    );
}
