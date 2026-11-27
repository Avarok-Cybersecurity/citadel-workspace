//! An answer is paired with the request that named an id, and only with that one.

use super::answer_frames::*;
use crate::kernel::apps::test_support::{workspace, Kernel};
use citadel_workspace_types::request_frame::answer_digest;
use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolResponse};

async fn frames(kernel: &Kernel, frame: &str, within_rate: bool) -> Vec<Vec<u8>> {
    frames_for(kernel, frame.as_bytes(), "boss", 9, within_rate).await
}

fn response(frame: &[u8]) -> WorkspaceProtocolResponse {
    match serde_json::from_slice(frame).expect("a payload") {
        WorkspaceProtocolPayload::Response(response) => *response,
        other => panic!("expected a response, got {other:?}"),
    }
}

fn pairing(frames: &[Vec<u8>]) -> (u64, String) {
    match response(&frames[1]) {
        WorkspaceProtocolResponse::Answered { request_id, digest } => (request_id, digest),
        other => panic!("expected Answered, got {other:?}"),
    }
}

#[tokio::test]
async fn a_request_without_an_id_gets_its_answer_alone_and_unchanged() {
    let kernel = workspace().await;
    let sent = frames(&kernel, r#"{"Request":"GetServerCapabilities"}"#, true).await;
    assert_eq!(sent.len(), 1);
    assert!(matches!(
        response(&sent[0]),
        WorkspaceProtocolResponse::ServerCapabilities {
            request_ids: Some(true),
            ..
        }
    ));
    // `response` decodes with the plain payload decoder an older agent uses; and no id key.
    assert!(!String::from_utf8_lossy(&sent[0]).contains(r#""request_id":"#));
}

#[tokio::test]
async fn a_request_with_an_id_gets_the_same_answer_then_its_pairing() {
    let kernel = workspace().await;
    let plain = frames(&kernel, r#"{"Request":"GetServerCapabilities"}"#, true).await;
    let named = frames(
        &kernel,
        r#"{"request_id":18446744073709551615,"Request":"GetServerCapabilities"}"#,
        true,
    )
    .await;
    assert_eq!(named.len(), 2);
    assert_eq!(named[0], plain[0], "the answer frame itself is unchanged");
    assert_eq!(pairing(&named), (u64::MAX, answer_digest(&named[0])));
}

#[tokio::test]
async fn refusals_are_paired_too() {
    let kernel = workspace().await;
    let cases = [
        // Read, and refused by the handler.
        (
            r#"{"request_id":3,"Request":{"DeleteNode":{"node_id":"no-such-node","cascade":false}}}"#,
            true,
        ),
        // Not a request this kernel knows.
        (r#"{"request_id":3,"Request":{"NoSuchRequest":{}}}"#, true),
        // Over the rate limit.
        (
            r#"{"request_id":3,"Request":"GetServerCapabilities"}"#,
            false,
        ),
    ];
    for (frame, within_rate) in cases {
        let sent = frames(&kernel, frame, within_rate).await;
        assert_eq!(sent.len(), 2, "{frame}");
        assert!(
            matches!(response(&sent[0]), WorkspaceProtocolResponse::Error(_)),
            "{frame}"
        );
        assert_eq!(pairing(&sent), (3, answer_digest(&sent[0])), "{frame}");
    }
    let unpaired = frames(&kernel, "not json", true).await;
    assert_eq!(unpaired.len(), 1);
}

#[tokio::test]
async fn a_response_sent_to_the_kernel_gets_nothing() {
    let kernel = workspace().await;
    let sent = frames(
        &kernel,
        r#"{"request_id":3,"Response":{"Error":"x"}}"#,
        true,
    )
    .await;
    assert!(sent.is_empty());
}
