//! Every byte field family of the workspace protocol keeps its JSON exactly.
//!
//! The byte fields are written with `serialize_bytes` (citadel_internal_service_types::wire_bytes)
//! so the page's codec hands them over as a Uint8Array. serde_json writes those bytes as the same
//! array of numbers a plain `Vec<u8>` gave, and reads that array back; a kernel or a page built
//! before the change must not see a different byte. Each frame here is read and written back,
//! and must come out byte for byte as it went in. The same file passes on the types from before
//! the change, which is what makes these frames the old wire and not merely the new one.

use citadel_workspace_types::server_identity::ServerIdentity;
use citadel_workspace_types::structs::Workspace;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use serde::de::DeserializeOwned;
use serde::Serialize;

fn written_back<T: Serialize + DeserializeOwned>(frame: &str) {
    let value: T = serde_json::from_str(frame).unwrap_or_else(|e| panic!("{frame}: {e}"));
    assert_eq!(serde_json::to_string(&value).unwrap(), frame);
}

const REQUESTS: &[&str] = &[
    // Documents: an update, a snapshot, a presence record; one empty.
    r#"{"Documents":{"Append":{"node_id":"n","doc_version":2,"update":[0,1,127,128,255],"client_seq":4294967296123}}}"#,
    r#"{"Documents":{"StoreSnapshot":{"node_id":"n","doc_version":2,"snapshot":[9,8,7],"upto_seq":3}}}"#,
    r#"{"Documents":{"Awareness":{"node_id":"n","payload":[]}}}"#,
    // Apps: a manifest, an artifact chunk, a host call, a relayed frame.
    r#"{"Apps":{"Publish":{"manifest_bytes":[123,125],"signature":"s"}}}"#,
    r#"{"Apps":{"UploadArtifactChunk":{"sha256":"h","index":0,"total_chunks":1,"bytes":[0,97,115,109]}}}"#,
    r#"{"Apps":{"Call":{"install_id":"i","call":[161,1,2]}}}"#,
    // Chat attachments and document pictures: upload chunks.
    r#"{"ChatAttachments":{"UploadChunk":{"node_id":"n","sha256":"h","size_bytes":3,"index":0,"total_chunks":1,"bytes":[1,2,3]}}}"#,
    r#"{"DocumentPictures":{"UploadChunk":{"doc":{"node_id":"n","chat_doc":null},"content_id":"c","size_bytes":2,"index":0,"total_chunks":1,"bytes":[137,80]}}}"#,
    // Metadata, present and absent; a theme; a message's contents.
    r#"{"CreateWorkspace":{"name":"w","description":"d","workspace_master_password":"p","metadata":[123,125]}}"#,
    r#"{"CreateWorkspace":{"name":"w","description":"d","workspace_master_password":"p","metadata":null}}"#,
    r#"{"UpdateNode":{"node_id":"n","name":null,"description":null,"mdx_content":null,"rules":null,"chat_enabled":null,"is_default":null,"metadata":[123,125]}}"#,
    r#"{"UpdateWorkspaceTheme":{"workspace_id":null,"theme":[123,125]}}"#,
    r#"{"Message":{"contents":[104,105]}}"#,
];

const RESPONSES: &[&str] = &[
    r#"{"Documents":{"DocumentUpdated":{"node_id":"n","seq":3,"doc_version":2,"update":[255,0],"author_cid":7340187244936118791}}}"#,
    r#"{"Documents":{"DocumentAwareness":{"node_id":"n","from_cid":5,"payload":[1]}}}"#,
    r#"{"Documents":{"Updates":{"node_id":"n","snapshot":{"doc_version":2,"bytes":[4,5],"upto_seq":3},"updates":[{"seq":4,"doc_version":2,"update":[6],"author_cid":5}],"has_more":false,"latest_seq":4}}}"#,
    r#"{"Apps":{"CallReply":{"reply":[161,0]}}}"#,
    r#"{"Apps":{"IhttpFrame":{"from":{"username":"u","cid":5,"app_id":"a","install_id":"i"},"to_install_id":"j","frame":[1,2]}}}"#,
    r#"{"ChatAttachments":{"Chunk":{"node_id":"n","attachment_id":"h","index":0,"total_chunks":1,"size_bytes":3,"bytes":[1,2,3]}}}"#,
    r#"{"DocumentPictures":{"Chunk":{"doc":{"node_id":"n","chat_doc":"d"},"content_id":"c","index":0,"total_chunks":1,"size_bytes":2,"bytes":[137,80]}}}"#,
];

#[test]
fn every_request_family_is_written_back_byte_for_byte() {
    for frame in REQUESTS {
        written_back::<WorkspaceProtocolRequest>(frame);
    }
}

#[test]
fn every_response_family_is_written_back_byte_for_byte() {
    for frame in RESPONSES {
        written_back::<WorkspaceProtocolResponse>(frame);
    }
}

#[test]
fn stored_records_keep_their_byte_fields() {
    written_back::<Workspace>(
        r#"{"id":"w","name":"W","description":"","owner_id":"o","members":[],"offices":[],"metadata":[123,125],"accepted_domains":[]}"#,
    );
    written_back::<ServerIdentity>(r#"{"domain":"example.org","pk":[1,2,3],"sig":[4,5]}"#);
}

#[test]
fn optional_metadata_left_out_still_reads_as_none() {
    let left_out: WorkspaceProtocolRequest = serde_json::from_str(
        r#"{"CreateWorkspace":{"name":"w","description":"d","workspace_master_password":"p"}}"#,
    )
    .unwrap();
    let null: WorkspaceProtocolRequest = serde_json::from_str(
        r#"{"CreateWorkspace":{"name":"w","description":"d","workspace_master_password":"p","metadata":null}}"#,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_string(&left_out).unwrap(),
        serde_json::to_string(&null).unwrap()
    );
}

#[test]
fn a_byte_field_sent_as_text_is_refused_as_before() {
    assert!(
        serde_json::from_str::<WorkspaceProtocolRequest>(r#"{"Message":{"contents":"aGk="}}"#)
            .is_err()
    );
}
