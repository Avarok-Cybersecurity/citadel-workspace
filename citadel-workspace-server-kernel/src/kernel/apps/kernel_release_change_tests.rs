//! A release that stops running takes its relay state with it: an update that takes effect and a
//! rollback each end the install's advertisements, so no caller is routed to a release that no
//! longer runs, and so does consenting to one that waited. Each beside its control (an update
//! waiting on consent keeps the old release, and what it serves).

use super::test_ihttp::*;
use super::test_manifests::*;
use super::test_runtime::*;
use super::test_support::Kernel;
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::InstallState;
use citadel_workspace_types::apps_protocol::AppsRequest;
use citadel_workspace_types::apps_responses::AppsResponse;
use serde_json::json;

/// bob's session serves `id`'s 1.0.0; 1.1.0 (`spec`) is uploaded and ready to update to.
async fn served(spec: &Spec) -> (Kernel, String, AppsRequest) {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let id = install(&kernel, "boss", InstallScope::Workspace, BOTH).await;
    assert!(matches!(
        advertise(&kernel, "bob", Some(BOB), &id).await,
        AppsResponse::Advertised { .. }
    ));
    upload(&kernel, "boss", &wasm(2, 4096)).await;
    let update = AppsRequest::Update {
        install_id: id.clone(),
        listing: signed(spec, &publisher(1), &wasm(2, 4096)),
    };
    (kernel, id, update)
}

fn serving(kernel: &Kernel, id: &str) -> bool {
    kernel
        .apps_relay()
        .lock()
        .host(id, None, now_ms())
        .is_some()
}

fn updated(answer: AppsResponse) -> InstallState {
    match answer {
        AppsResponse::Updated { install } => install.state,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn an_update_that_takes_effect_ends_what_the_old_release_served() {
    let spec = Spec {
        version: "1.1.0",
        ..runtime_spec()
    };
    let (kernel, id, update) = served(&spec).await;
    assert!(serving(&kernel, &id));
    let state = updated(ask_on(&kernel, "boss", None, update).await);
    assert_eq!(state, InstallState::Active);
    assert!(
        !serving(&kernel, &id),
        "the old release is still advertised"
    );
}

#[tokio::test]
async fn an_update_waiting_on_consent_keeps_the_old_release_serving_until_consented() {
    let mut capabilities = runtime_spec().capabilities;
    let grown = json!({ "cap": "nodes.read", "why": "Now reads nodes", "optional": false });
    capabilities.as_array_mut().expect("a list").push(grown);
    let spec = Spec {
        version: "1.1.0",
        capabilities,
        ..runtime_spec()
    };
    let (kernel, id, update) = served(&spec).await;
    let state = updated(ask_on(&kernel, "boss", None, update).await);
    assert!(
        matches!(state, InstallState::NeedsConsent { .. }),
        "{state:?}"
    );
    assert!(
        serving(&kernel, &id),
        "the release that still runs lost its advertisement"
    );
    // Consented, the new release runs, and what the old one served ends with it.
    let mut granted = vec![Capability::Canvas, Capability::NodesRead];
    granted.extend_from_slice(BOTH);
    let consent = AppsRequest::Consent {
        install_id: id.clone(),
        version: "1.1.0".into(),
        granted,
        pinned_publisher_key: publisher(1).public_key_hex(),
    };
    let answer = ask_on(&kernel, "boss", None, consent).await;
    assert!(
        matches!(answer, AppsResponse::Consented { .. }),
        "{answer:?}"
    );
    assert!(
        !serving(&kernel, &id),
        "consented, the old release is still advertised"
    );
}

#[tokio::test]
async fn a_rollback_ends_what_the_rolled_back_release_served() {
    let spec = Spec {
        version: "1.1.0",
        ..runtime_spec()
    };
    let (kernel, id, update) = served(&spec).await;
    updated(ask_on(&kernel, "boss", None, update).await);
    assert!(matches!(
        advertise(&kernel, "bob", Some(BOB), &id).await,
        AppsResponse::Advertised { .. }
    ));
    let rollback = AppsRequest::Rollback {
        install_id: id.clone(),
    };
    let answer = ask_on(&kernel, "mgr", None, rollback).await;
    assert!(
        matches!(answer, AppsResponse::RolledBack { .. }),
        "{answer:?}"
    );
    assert!(
        !serving(&kernel, &id),
        "the rolled-back release is still advertised"
    );
}
