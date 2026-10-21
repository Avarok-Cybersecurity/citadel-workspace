//! The workspace registry: who may publish, what versions it takes, and who sees a listing.

use super::test_manifests::*;
use super::test_support::{ask, workspace, Kernel};
use citadel_workspace_types::apps_install::AppsRefusal;
use citadel_workspace_types::apps_protocol::{AppsRequest, ListingOffer};
use citadel_workspace_types::apps_responses::AppsResponse;
use citadel_workspace_types::structs::Permission;
use serde_json::json;

fn publish_request(offer: ListingOffer) -> AppsRequest {
    let ListingOffer::Signed {
        manifest_bytes,
        signature,
    } = offer
    else {
        unreachable!()
    };
    AppsRequest::Publish {
        manifest_bytes,
        signature,
    }
}

async fn publish(kernel: &Kernel, user: &str, spec: &Spec, n: u8) -> AppsResponse {
    let (key, bytes) = (publisher(1), wasm(n, 4096));
    upload(kernel, user, &bytes).await;
    ask(kernel, user, publish_request(signed(spec, &key, &bytes))).await
}

fn published(answer: &AppsResponse) -> bool {
    matches!(answer, AppsResponse::Published { entry_id } if entry_id == "com.acme.kanban")
}

#[tokio::test]
async fn publishing_takes_app_publish_and_an_audience_that_is_not_global() {
    let kernel = workspace().await;
    let spec = Spec::new("1.0.0");
    let answer = publish(&kernel, "alice", &spec, 1).await;
    assert_eq!(
        answer,
        AppsResponse::Refused(AppsRefusal::PermissionRequired(Permission::AppPublish))
    );
    let global = Spec {
        audience: json!({ "kind": "global" }),
        ..Spec::new("1.0.0")
    };
    let answer = publish(&kernel, "mgr", &global, 1).await;
    assert!(
        matches!(
            answer,
            AppsResponse::Refused(AppsRefusal::InvalidManifest(_))
        ),
        "{answer:?}"
    );
    assert!(published(&publish(&kernel, "mgr", &spec, 1).await));
}

#[tokio::test]
async fn each_publish_of_an_app_is_a_strictly_newer_version() {
    let kernel = workspace().await;
    assert!(published(
        &publish(&kernel, "mgr", &Spec::new("1.1.0"), 1).await
    ));
    for (version, n) in [("1.1.0", 2), ("1.0.9", 3)] {
        assert_eq!(
            publish(&kernel, "mgr", &Spec::new(version), n).await,
            AppsResponse::Refused(AppsRefusal::VersionNotNewer),
            "{version}"
        );
    }
    assert!(published(
        &publish(&kernel, "mgr", &Spec::new("1.2.0"), 4).await
    ));
}

fn listed(answer: &AppsResponse) -> usize {
    match answer {
        AppsResponse::Catalogue { listings } => listings.len(),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_listing_reaches_its_audience_and_is_unavailable_to_everyone_else_as_if_missing() {
    let kernel = workspace().await;
    let spec = Spec {
        audience: json!({ "kind": "members", "usernames": ["alice"] }),
        ..Spec::new("1.0.0")
    };
    assert!(published(&publish(&kernel, "mgr", &spec, 1).await));
    assert_eq!(
        listed(&ask(&kernel, "alice", AppsRequest::ListCatalogue).await),
        1
    );
    assert_eq!(
        listed(&ask(&kernel, "bob", AppsRequest::ListCatalogue).await),
        0
    );
    let get = |app_id: &str| AppsRequest::GetListing {
        app_id: app_id.to_string(),
    };
    assert!(matches!(
        ask(&kernel, "alice", get("com.acme.kanban")).await,
        AppsResponse::Listing { .. }
    ));
    let hidden = ask(&kernel, "bob", get("com.acme.kanban")).await;
    let missing = ask(&kernel, "bob", get("com.acme.nothing")).await;
    assert_eq!(hidden, AppsResponse::Refused(AppsRefusal::Unavailable));
    assert_eq!(
        serde_json::to_vec(&hidden).unwrap(),
        serde_json::to_vec(&missing).unwrap(),
        "the same bytes"
    );
}

#[tokio::test]
async fn a_node_audience_admits_whoever_views_the_node() {
    let kernel = workspace().await;
    let spec = Spec {
        audience: json!({ "kind": "node_viewers", "node_id": "office" }),
        ..Spec::new("1.0.0")
    };
    assert!(published(&publish(&kernel, "mgr", &spec, 1).await));
    // carol views the room below the office, not the office.
    assert_eq!(
        listed(&ask(&kernel, "carol", AppsRequest::ListCatalogue).await),
        0
    );
    assert_eq!(
        listed(&ask(&kernel, "bob", AppsRequest::ListCatalogue).await),
        1
    );
    let tree = Spec {
        audience: json!({ "kind": "node_tree_viewers", "node_id": "office" }),
        ..Spec::new("1.1.0")
    };
    assert!(published(&publish(&kernel, "mgr", &tree, 2).await));
    assert_eq!(
        listed(&ask(&kernel, "carol", AppsRequest::ListCatalogue).await),
        1
    );
}

#[tokio::test]
async fn a_registry_install_reads_the_entry_and_its_audience() {
    let kernel = workspace().await;
    let spec = Spec {
        audience: json!({ "kind": "members", "usernames": ["alice", "inst"] }),
        ..Spec::new("1.0.0")
    };
    assert!(published(&publish(&kernel, "mgr", &spec, 1).await));
    let key = publisher(1);
    let caps = [
        citadel_workspace_types::apps::Capability::Canvas,
        citadel_workspace_types::apps::Capability::NodesRead,
    ];
    let registry = || ListingOffer::Registry {
        entry_id: "com.acme.kanban".to_string(),
    };
    let scope = citadel_workspace_types::apps::InstallScope::SelfOnly("bob".into());
    let request = install_request(&spec, &key, registry(), scope, &caps, false);
    assert_eq!(
        ask(&kernel, "bob", request).await,
        AppsResponse::Refused(AppsRefusal::Unavailable),
        "bob is not in the audience"
    );
    let scope = citadel_workspace_types::apps::InstallScope::Users(vec!["alice".into()]);
    let request = install_request(&spec, &key, registry(), scope, &caps, false);
    assert!(matches!(
        ask(&kernel, "inst", request).await,
        AppsResponse::Installed { .. }
    ));
}
