//! The codec against the workspace types' own serialisation: what it sends is the request the
//! kernel parses, and what it reads is the response the kernel writes. The end-to-end proof,
//! against the real kernel over a real session, is identity_setup_tests.rs.

use super::*;
use citadel_workspace_types::server_identity::ServerIdentity;

const NONCE: [u8; SERVER_IDENTITY_NONCE_LEN] = [7; SERVER_IDENTITY_NONCE_LEN];

fn response_frame(response: WorkspaceProtocolResponse) -> Vec<u8> {
    serde_json::to_vec(&WorkspaceProtocolPayload::Response(Box::new(response))).unwrap()
}

#[test]
fn the_challenge_is_the_request_the_kernel_parses() {
    let frame = WorkspaceServerIdentityCodec.challenge(&NONCE).unwrap();
    let parsed: WorkspaceProtocolPayload = serde_json::from_slice(&frame).unwrap();
    match parsed {
        WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::ServerIdentityChallenge(c)) => {
            assert_eq!(c.nonce, NONCE)
        }
        other => panic!("not a challenge: {other:?}"),
    }
}

#[test]
fn the_kernel_s_answer_is_read_field_for_field() {
    let frame = response_frame(WorkspaceProtocolResponse::ServerIdentity(ServerIdentity {
        domain: "acme.example".into(),
        pk: vec![1, 2, 3],
        sig: vec![4, 5],
    }));
    let answer = WorkspaceServerIdentityCodec.answer(&frame).unwrap();
    assert_eq!(answer.domain, "acme.example");
    assert_eq!(answer.pk, vec![1, 2, 3]);
    assert_eq!(answer.sig, vec![4, 5]);
}

#[test]
fn every_other_frame_goes_on_to_the_windows() {
    let codec = WorkspaceServerIdentityCodec;
    // The challenge itself, echoed or forwarded, names `"ServerIdentityChallenge"`, not the key.
    assert!(codec.answer(&codec.challenge(&NONCE).unwrap()).is_none());
    // A refusal that mentions the key in its text is still not an answer.
    let refusal = response_frame(WorkspaceProtocolResponse::Error(
        "\"ServerIdentity\" asked again within a second".into(),
    ));
    assert!(codec.answer(&refusal).is_none());
    assert!(codec.answer(b"\"ServerIdentity\" not json").is_none());
    assert!(codec.answer(b"").is_none());
}
