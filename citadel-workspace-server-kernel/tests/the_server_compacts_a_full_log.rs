//! The server compacts a document's log itself once the updates since its last snapshot reach
//! `compact_at_pending_bytes`, and when an append is refused `LogFull`. Sizes here are about
//! one byte per character typed, plus a few bytes of each update's framing.
//!
//! The compaction hint asks a writer to snapshot, but a log whose writers ignore it, or have all
//! left, would otherwise fill and refuse every append. The server builds the snapshot from the
//! log itself and announces it, so a refused writer knows when to send again.

use citadel_workspace_server_kernel::kernel::async_kernel::BroadcastMessage;
use citadel_workspace_server_kernel::kernel::documents::DocumentsConfig;
use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use citadel_workspace_types::WorkspaceProtocolResponse;
use common::documents_test_utils::*;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

const UPDATE_BYTES: u64 = 2048;

fn limits() -> DocumentsConfig {
    DocumentsConfig {
        snapshot_min_updates: 1,
        max_update_bytes: UPDATE_BYTES,
        compact_at_pending_bytes: UPDATE_BYTES,
        max_pending_log_bytes: 3000,
        ..shipped_documents_config()
    }
}

fn append_request(node: &str, update: Vec<u8>) -> DocumentsRequest {
    DocumentsRequest::Append {
        node_id: node.to_string(),
        doc_version: 1,
        update,
        client_seq: 1,
    }
}

fn compacted(seen: &[BroadcastMessage], node: &str) -> Vec<u64> {
    seen.iter()
        .filter_map(|msg| match &msg.response {
            WorkspaceProtocolResponse::Documents(DocumentsResponse::DocumentCompacted {
                node_id,
                upto_seq,
            }) if node_id == node => Some(*upto_seq),
            _ => None,
        })
        .collect()
}

/// The text a new reader of `node` ends up with.
async fn read_back(kernel: &common::member_test_utils::GateKernel, node: &str) -> (u64, String) {
    let DocumentsResponse::Updates {
        snapshot: Some(snapshot),
        updates,
        ..
    } = pull(kernel, TEST_ADMIN_USER_ID, node, 0).await
    else {
        panic!("a new reader was not sent a snapshot");
    };
    let mut reader = Replica::from_snapshot(&snapshot.bytes);
    for update in &updates {
        reader.absorb(&update.update);
    }
    (snapshot.upto_seq, reader.text())
}

#[tokio::test]
async fn a_log_past_the_threshold_is_compacted_by_the_server_and_announced() {
    let kernel = with_limits(limits()).await;
    let node = document_node(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();
    let mut author = Replica::new(70);
    let garbage = append_request(&node, vec![0xAB; 32]);
    let refused = documents(send(&kernel, TEST_ADMIN_USER_ID, 7, garbage).await);
    assert!(
        matches!(
            refused,
            DocumentsResponse::Refused(DocumentRefusal::UpdateMalformed { .. })
        ),
        "{refused:?}"
    );
    // Under the threshold, then past it.
    let first = author.typed(&"h".repeat(1200));
    append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &first).await;
    let past = author.typed(&"w".repeat(1200));
    assert_eq!(
        append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &past).await,
        2
    );

    assert_eq!(compacted(&drain(&mut rx).await, &node), vec![2]);
    assert_eq!(read_back(&kernel, &node).await, (2, author.text()));
}

#[tokio::test]
async fn a_writer_refused_log_full_appends_once_the_server_has_compacted() {
    let kernel = with_limits(limits()).await;
    let node = document_node(&kernel).await;
    let mut rx = kernel.subscribe_broadcast();
    let mut author = Replica::new(70);
    let near = "n".repeat(1500);
    // Under the threshold, so nothing compacts yet.
    append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &author.typed(&near)).await;
    let first_text = author.text();
    // Over the cap at once: refused, and the refusal starts a compaction.
    let big = author.typed(&"b".repeat(1900));
    let answer = documents(
        send(
            &kernel,
            TEST_ADMIN_USER_ID,
            7,
            append_request(&node, big.clone()),
        )
        .await,
    );
    assert!(
        matches!(
            answer,
            DocumentsResponse::Refused(DocumentRefusal::LogFull { .. })
        ),
        "{answer:?}"
    );
    assert_eq!(compacted(&drain(&mut rx).await, &node), vec![1]);
    assert_eq!(read_back(&kernel, &node).await, (1, first_text));
    assert_eq!(append(&kernel, TEST_ADMIN_USER_ID, 7, &node, &big).await, 2);
}
