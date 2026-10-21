//! The shipped `[documents]` rates: ten appends, ten pulls and ten awareness payloads per
//! session per second (owner decision, 19 Oct 2026).
//!
//! Measured, not read: each test drives the relay built from the SHIPPED kernel.toml and counts
//! how many requests one session gets through before the first refusal, so a value in the file
//! that the relay did not enforce, or enforced differently, fails here.

use citadel_workspace_types::documents::{DocumentRefusal, DocumentsRequest, DocumentsResponse};
use common::documents_test_utils::*;
use common::member_test_utils::GateKernel;
use common::workspace_test_utils::TEST_ADMIN_USER_ID;

const SHIPPED_PER_SECOND: usize = 10;
/// Far above any rate the file could plausibly ship, so a missing limit still terminates.
const CEILING: usize = 1_000;

/// How many requests session `cid` got through before the first one `limited` recognises.
async fn admitted_before_refusal(
    kernel: &GateKernel,
    cid: u64,
    mut request: impl FnMut() -> DocumentsRequest,
    limited: impl Fn(&DocumentsResponse) -> bool,
) -> usize {
    for admitted in 0..CEILING {
        let answer = documents(send(kernel, TEST_ADMIN_USER_ID, cid, request()).await);
        if limited(&answer) {
            return admitted;
        }
        assert!(
            !matches!(answer, DocumentsResponse::Refused(_)),
            "refused for another reason: {answer:?}"
        );
    }
    panic!("{CEILING} requests in a row were admitted: no rate limit is enforced");
}

#[tokio::test]
async fn ten_appends_a_second() {
    let kernel = with_limits(shipped_documents_config()).await;
    let node = document_node(&kernel).await;
    let mut author = Replica::new(90);
    let admitted = admitted_before_refusal(
        &kernel,
        21,
        || DocumentsRequest::Append {
            node_id: node.clone(),
            doc_version: 1,
            update: author.typed("x"),
            client_seq: 1,
        },
        |answer| {
            matches!(
                answer,
                DocumentsResponse::Refused(DocumentRefusal::AppendRateLimited { .. })
            )
        },
    )
    .await;
    assert_eq!(admitted, SHIPPED_PER_SECOND);
}

#[tokio::test]
async fn ten_pulls_a_second() {
    let kernel = with_limits(shipped_documents_config()).await;
    let node = document_node(&kernel).await;
    let admitted = admitted_before_refusal(
        &kernel,
        22,
        || DocumentsRequest::Pull {
            node_id: node.clone(),
            since_seq: 0,
        },
        |answer| {
            matches!(
                answer,
                DocumentsResponse::Refused(DocumentRefusal::PullRateLimited { .. })
            )
        },
    )
    .await;
    assert_eq!(admitted, SHIPPED_PER_SECOND);
}

#[tokio::test]
async fn ten_awareness_payloads_a_second() {
    let kernel = with_limits(shipped_documents_config()).await;
    let node = document_node(&kernel).await;
    let admitted = admitted_before_refusal(
        &kernel,
        23,
        || DocumentsRequest::Awareness {
            node_id: node.clone(),
            payload: vec![1],
        },
        |answer| {
            matches!(
                answer,
                DocumentsResponse::Refused(DocumentRefusal::AwarenessRateLimited { .. })
            )
        },
    )
    .await;
    assert_eq!(admitted, SHIPPED_PER_SECOND);
}
