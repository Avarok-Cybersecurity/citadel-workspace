//! `UpdateUserProfile` gained `email` and `title`; a client built before them
//! still sends `{ name, avatar_data }` and must keep working.
//!
//! No protocol enum here carries a version field, so a request that fails to
//! deserialize fails the whole message. A missing `Option` must read as `None`.

use citadel_workspace_types::{WorkspaceProtocolPayload, WorkspaceProtocolRequest};

fn parse(json: &str) -> WorkspaceProtocolRequest {
    match serde_json::from_str::<WorkspaceProtocolPayload>(json).expect("deserializes") {
        WorkspaceProtocolPayload::Request(request) => request,
        other => panic!("not a request: {other:?}"),
    }
}

#[test]
fn a_request_from_an_older_client_reads_the_new_fields_as_absent() {
    let request = parse(r#"{"Request":{"UpdateUserProfile":{"name":"Ada","avatar_data":null}}}"#);
    match request {
        WorkspaceProtocolRequest::UpdateUserProfile {
            name,
            avatar_data,
            email,
            title,
        } => {
            assert_eq!(name.as_deref(), Some("Ada"));
            assert_eq!(avatar_data, None);
            assert_eq!(email, None);
            assert_eq!(title, None);
        }
        other => panic!("wrong variant: {other:?}"),
    }
}

#[test]
fn the_new_fields_round_trip() {
    let request = parse(
        r#"{"Request":{"UpdateUserProfile":{"name":null,"avatar_data":null,"email":"ada@example.com","title":""}}}"#,
    );
    match request {
        WorkspaceProtocolRequest::UpdateUserProfile { email, title, .. } => {
            assert_eq!(email.as_deref(), Some("ada@example.com"));
            assert_eq!(title.as_deref(), Some(""));
        }
        other => panic!("wrong variant: {other:?}"),
    }
}
