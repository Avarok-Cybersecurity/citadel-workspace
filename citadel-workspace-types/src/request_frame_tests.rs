use crate::request_frame::*;
use crate::{WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse};

fn frame(text: &str) -> Result<RequestFrame, serde_json::Error> {
    serde_json::from_str(text)
}

#[test]
fn a_frame_without_an_id_decodes_as_it_always_did() {
    let decoded = frame(r#"{"Request":"GetServerCapabilities"}"#).unwrap();
    assert!(decoded.request_id.is_none());
    assert!(matches!(
        decoded.payload,
        WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::GetServerCapabilities)
    ));
}

#[test]
fn the_id_is_read_beside_the_payload_in_either_order() {
    for text in [
        r#"{"request_id":18446744073709551615,"Request":"GetServerCapabilities"}"#,
        r#"{"Request":"GetServerCapabilities","request_id":18446744073709551615}"#,
    ] {
        let decoded = frame(text).unwrap();
        assert_eq!(decoded.request_id, Some(u64::MAX), "{text}");
        assert!(matches!(
            decoded.payload,
            WorkspaceProtocolPayload::Request(WorkspaceProtocolRequest::GetServerCapabilities)
        ));
    }
}

#[test]
fn any_other_key_two_payloads_or_two_ids_are_refused() {
    for text in [
        r#"{"Request":"GetServerCapabilities","extra":1}"#,
        r#"{"Request":"GetServerCapabilities","Request":"GetServerCapabilities"}"#,
        r#"{"request_id":1,"request_id":2,"Request":"GetServerCapabilities"}"#,
        r#"{"request_id":-1,"Request":"GetServerCapabilities"}"#,
        r#"{"request_id":1}"#,
    ] {
        assert!(frame(text).is_err(), "{text}");
    }
}

#[test]
fn the_id_of_an_undecodable_frame_is_still_read() {
    assert_eq!(
        request_id_of(br#"{"request_id":7,"Request":{"NoSuchRequest":{}}}"#),
        Some(7)
    );
    assert_eq!(
        request_id_of(br#"{"Request":"GetServerCapabilities"}"#),
        None
    );
    assert_eq!(request_id_of(b"not json"), None);
}

/// The page computes the same digest (answer-window.ts); this vector is asserted on both sides.
#[test]
fn the_digest_is_hex_sha256_of_the_exact_bytes() {
    assert_eq!(
        answer_digest(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let marker =
        WorkspaceProtocolPayload::Response(Box::new(WorkspaceProtocolResponse::Answered {
            request_id: 7,
            digest: answer_digest(b"abc"),
        }));
    assert_eq!(
        serde_json::to_string(&marker).unwrap(),
        r#"{"Response":{"Answered":{"request_id":7,"digest":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}}}"#
    );
}
