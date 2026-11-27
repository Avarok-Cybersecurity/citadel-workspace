//! The frame a kernel sends after an answer it pairs with a request id
//! (citadel-workspace-types/src/request_frame.rs) is nothing to this agent's taps: grants,
//! identity and telemetry each read it as unrelated, so `on_server_frame` forwards it to the
//! session's windows and changes nothing. The answer before it is the frame it always was.
//!
//! The frame is written as the bytes such a kernel sends, not built from the types, so this file
//! compiles and runs unchanged against types that have never heard of it -- an agent built before
//! request ids -- where every tap fails to parse it, which is the same verdict.
//! Each tap is shown a frame it does act on beside it, so a tap that ignored everything would fail.

use crate::apps_authority::WorkspaceHostNetAuthority;
use crate::server_identity_codec::WorkspaceServerIdentityCodec;
use crate::telemetry::WorkspaceTelemetryCodec;
use citadel_internal_service::kernel::identity::ServerIdentityCodec;
use citadel_internal_service::telemetry::{ServerSignal, TelemetryCodec};
use citadel_internal_service::{AuthoritySignal, HostNetAuthority};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::server_identity::ServerIdentity;
use citadel_workspace_types::telemetry::TelemetryResponse;
use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolResponse};

/// As a pairing kernel sends it; the digest is SHA-256 of `abc`, any 64 hex digits will do.
const PAIRING: &[u8] = br#"{"Response":{"Answered":{"request_id":18446744073709551615,"digest":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}}}"#;

fn frame(response: WorkspaceProtocolResponse) -> Vec<u8> {
    serde_json::to_vec(&WorkspaceProtocolPayload::Response(Box::new(response))).unwrap()
}

#[test]
fn the_grant_tap_ignores_a_pairing_frame() {
    let tap = WorkspaceHostNetAuthority;
    assert!(matches!(tap.classify(PAIRING), AuthoritySignal::Unrelated));
    let acted_on = frame(WorkspaceProtocolResponse::Apps(
        AppsResponse::InstallsChanged,
    ));
    assert!(matches!(
        tap.classify(&acted_on),
        AuthoritySignal::InstallsChanged
    ));
}

#[test]
fn the_identity_tap_ignores_a_pairing_frame() {
    let tap = WorkspaceServerIdentityCodec;
    assert!(tap.answer(PAIRING).is_none());
    let acted_on = frame(WorkspaceProtocolResponse::ServerIdentity(ServerIdentity {
        domain: "example.test".into(),
        pk: vec![1],
        sig: vec![2],
    }));
    assert!(tap.answer(&acted_on).is_some());
}

#[test]
fn the_telemetry_tap_ignores_a_pairing_frame() {
    let tap = WorkspaceTelemetryCodec::new("0.0.0", "test");
    assert!(matches!(tap.classify(PAIRING), ServerSignal::Unrelated));
    let acted_on = frame(WorkspaceProtocolResponse::Telemetry(
        TelemetryResponse::Uploaded { stored_entries: 1 },
    ));
    assert!(matches!(
        tap.classify(&acted_on),
        ServerSignal::UploadStored
    ));
}
