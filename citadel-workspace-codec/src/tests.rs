//! The codec's checks, natively: what it reads it reads through the protocol's types, and what
//! it writes is the JSON the kernel reads (serde_json over the same types). The page's shapes
//! (BigInt, Uint8Array, null, plain objects) are held by citadel-workspace-client-ts's tests,
//! which load the built module.

use super::{read, write};

const APPEND: &str = r#"{"Request":{"Documents":{"Append":{"node_id":"n1","doc_version":2,"update":[0,1,255],"client_seq":18446744073709551615}}}}"#;

#[test]
fn a_payload_is_written_back_as_the_same_json() {
    let payload = read(APPEND.as_bytes()).unwrap();
    assert_eq!(String::from_utf8(write(&payload).unwrap()).unwrap(), APPEND);
}

#[test]
fn a_u64_keeps_every_bit() {
    let written = write(&read(APPEND.as_bytes()).unwrap()).unwrap();
    assert!(String::from_utf8(written)
        .unwrap()
        .contains("18446744073709551615"));
}

#[test]
fn json_that_is_not_a_payload_is_refused_not_cast() {
    for bad in [
        r#"{"Request":{"Documents":{"Append":{"node_id":"n1","doc_version":2,"update":[0],"client_seq":-1}}}}"#,
        r#"{"Request":{"Documents":{"Append":{"node_id":"n1","doc_version":2,"update":"AAE=","client_seq":1}}}}"#,
        r#"{"Request":{"Documents":{"Append":{"node_id":"n1","doc_version":2,"client_seq":1}}}}"#,
        r#"{"Request":{"NoSuchRequest":{}}}"#,
        r#"{"Response":{"Error":"Not in workspace"},"Request":"ListWorkspaces"}"#,
        r#"[1,2,3]"#,
        "{",
    ] {
        assert!(read(bad.as_bytes()).is_err(), "{bad} was read");
    }
}

#[test]
fn a_refusal_names_where_not_what() {
    let secret = r#"{"Request":{"Documents":{"Append":{"node_id":"n1","doc_version":"hunter2","update":[0],"client_seq":1}}}}"#;
    let err = read(secret.as_bytes()).unwrap_err();
    assert!(!err.contains("hunter2"), "{err}");
    assert!(err.contains("line 1 column"), "{err}");
}
