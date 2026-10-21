//! The apps protocol on the workspace wire: its place in the request and response enums, and
//! the fields a request cannot leave out.

use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer, ARTIFACT_CHUNK_BYTES};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::{WorkspaceProtocolRequest, WorkspaceProtocolResponse};
use serde_json::json;

#[test]
fn apps_requests_and_answers_ride_the_workspace_protocol() {
    let request: WorkspaceProtocolRequest =
        serde_json::from_value(json!({ "Apps": "ListCatalogue" })).unwrap();
    assert!(matches!(
        request,
        WorkspaceProtocolRequest::Apps(AppsRequest::ListCatalogue)
    ));
    let answer = WorkspaceProtocolResponse::Apps(AppsResponse::Refused(AppsRefusal::Unavailable));
    assert_eq!(
        serde_json::to_value(answer).unwrap(),
        json!({ "Apps": { "Refused": "Unavailable" } })
    );
}

#[test]
fn an_install_names_where_its_listing_comes_from() {
    let install = |listing: Option<serde_json::Value>| {
        let mut fields = json!({
            "app_id": "com.acme.kanban", "version": "1.0.0", "scope": "Workspace",
            "granted": ["canvas"], "pinned_publisher_key": "ab", "inject_requirement": false
        });
        if let Some(listing) = listing {
            fields["listing"] = listing;
        }
        serde_json::from_value::<AppsRequest>(json!({ "Install": fields }))
    };
    assert!(install(None).is_err(), "no listing, no install");
    let registry = install(Some(
        json!({ "Registry": { "entry_id": "com.acme.kanban" } }),
    ));
    assert!(matches!(
        registry,
        Ok(AppsRequest::Install {
            listing: ListingOffer::Registry { .. },
            ..
        })
    ));
}

#[test]
fn a_signed_listing_prints_its_manifests_length_never_its_bytes() {
    let offer = ListingOffer::Signed {
        manifest_bytes: b"{\"secret\":1}".to_vec(),
        signature: "00".to_string(),
    };
    let printed = format!("{offer:?}");
    assert!(
        !printed.contains("secret") && !printed.contains("123, 34"),
        "{printed}"
    );
}

/// A tenant's socket closes on a message over this (`billing/tiers.json`, the SSOT).
fn max_frame_bytes() -> usize {
    let tiers: serde_json::Value =
        serde_json::from_str(include_str!("../../billing/tiers.json")).unwrap();
    tiers["metering"]["max_frame_bytes"].as_u64().unwrap() as usize
}

fn upload_json_len(bytes: Vec<u8>) -> usize {
    let request = WorkspaceProtocolRequest::Apps(AppsRequest::UploadArtifactChunk {
        sha256: "f".repeat(64),
        index: 31,
        total_chunks: 32,
        bytes,
    });
    serde_json::to_vec(&request).unwrap().len()
}

#[test]
fn a_full_upload_chunk_is_under_a_mebibyte_of_json_and_far_under_a_frame() {
    let full = ARTIFACT_CHUNK_BYTES as usize;
    let every_byte_value: Vec<u8> = (0..full).map(|i| i as u8).collect();
    let typical = upload_json_len(every_byte_value);
    assert!(typical < 1024 * 1024, "{typical} bytes");
    // Every byte 255 is four characters ("255,"): the most a chunk can take.
    let worst = upload_json_len(vec![255; full]);
    assert!(worst < max_frame_bytes() / 3, "{worst} bytes");
}
